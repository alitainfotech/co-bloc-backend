const Mailgun = require('mailgun.js');
const formData = require('form-data');
const fs = require('fs');
const puppeteer = require("puppeteer");
const ejs = require("ejs")
const axios = require("axios");
const path = require('path');
var CryptoJS = require("crypto-js");
require("dotenv").config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const {STATUS_CODE, STATUS_ERROR} = require("./commonConstant");
const {
    decryptAccessToken,
    getZohoHeaders,
    refreshAccessToken,
    CommonFunForCatch
} = require('./services/commonFuncions');



exports.RefreshAccessToken = async (req, res) => {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
    const refreshTokenURL = `${process.env.REFRESH_TOKEN_URL}/token`;

    const data = {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
    };

    try {
        const response = await axios.post(refreshTokenURL, null, {
            params: data,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        const responseData = response.data;

        if (responseData.access_token) {
            const accessToken = responseData.access_token;
            let bcryptToken = CryptoJS.AES.encrypt(accessToken, process.env.SECRET_KEY).toString();
            return res.json({ accessToken: bcryptToken });
        } else {
            console.error('Error refreshing access token. Response:', responseData);
            res.status(500).json({ error: req.t("ACCESS_TOKEN_ERROR") });
        }
    } catch (error) {
        console.error('Error refreshing access token:', error);
        res.status(500).json({ error: req.t("ACCESS_TOKEN_ERROR") });
    }
}


exports.Pay = async (req, res) => {
    try {
        const { amount, currency } = req.body;
        const convertedAmount = truncateToDecimals(amount) * 100; // Currency is EURO for now but we need to convert the amount into multiple of 100 despite of any currency...
        const paymentIntent = await stripe.paymentIntents.create({
            amount: convertedAmount,
            currency: currency,
        });
        res.send({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        return res
            .status(500)
            .send({ error: req.t("PAYMENT_ERROR") });
    }
};


exports.addUser = async (req, res) => {

    const zohoApiBaseUrl = `${process.env.ZOHO_CRM_V2_URL}/Customer`;

    try {
        const accessToken = req.headers.authorization.split(" ")[1];
        const decryptToken = decryptAccessToken(accessToken, process.env.SECRET_KEY);

        const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
            headers: getZohoHeaders(decryptToken)
        });

        if (checkUserResponse.status !== 200) {

            const response = await axios.post(zohoApiBaseUrl, removeTags(JSON.stringify(req.body)), {
                headers: getZohoHeaders(decryptToken)
            });

            if (response.status === 200 || response.status === 201) {
                const responseData = response.data;
                if (responseData && responseData.data && responseData?.data[0].details.id) {
                    const userId = responseData.data[0].details.id;
                    const getUserUrl = `${zohoApiBaseUrl}/${userId}`;
                    const getUserResponse = await axios.get(getUserUrl, {
                        headers: getZohoHeaders(decryptToken)
                    });

                    if (getUserResponse.status === 200) {
                        return res.status(getUserResponse.status).send(getUserResponse.data);
                    }
                }
            } else {
                return res.status(response.status).json({ message: req.t("FAILED_CREATE_USER") });
            }
        } else {
            return res.status(checkUserResponse.status).json(checkUserResponse.data);
        }
    } catch (error) {
        if (
            error.response &&
            STATUS_CODE.includes(error.response.status) &&
            STATUS_ERROR.includes(error.response.data.code)
        ) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
                    headers: getZohoHeaders(decryptToken)
                });
                if (checkUserResponse.status !== 200) {
                    const responseData = await CommonFunForCatch(zohoApiBaseUrl, 'post', `${decryptToken}`, removeTags(JSON.stringify(req.body)));
                    return res.status(200).send(responseData);
                } else {
                    return res.status(checkUserResponse.status).json(checkUserResponse.data);
                }
            } catch (error) {
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};


exports.Payment = async (req, res) => {

    const zohoApiBaseUrlforPayment = `${process.env.ZOHO_CRM_V2_URL}/Payment`;

    try {
        const accessToken = req.headers.authorization.split(" ")[1];
        const decryptToken = decryptAccessToken(accessToken, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforPayment, removeTags(JSON.stringify(req.body)), {
            headers: getZohoHeaders(decryptToken)
        });

        if (response.status === 200 || response.status === 201) {
            const responseData = response.data;
            if (responseData && responseData.data && responseData.data[0].details.id) {
                const userId = responseData.data[0].details.id;
                const getUserUrl = `${zohoApiBaseUrlforPayment}/${userId}`;
                const getUserResponse = await axios.get(getUserUrl, {
                    headers: getZohoHeaders(decryptToken)
                });

                if (getUserResponse.status === 200) {
                    return res.status(getUserResponse.status).send(getUserResponse.data);
                } else {
                    return res.status(getUserResponse.status).json({ message: req.t("PAYMENT_FETCH_DATA_FAILED") });
                }
            }
        } else {
            return res.status(response.status).json({ message: req.t("FAILED_PAYMENT") });
        }
    } catch (error) {
        if (
            error.response &&
            STATUS_CODE.includes(error.response.status) &&
            STATUS_ERROR.includes(error.response.data.code)
        ) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const responseData = await CommonFunForCatch(zohoApiBaseUrlforPayment, 'post', `${decryptToken}`, removeTags(JSON.stringify(req.body)));
                return res.status(200).send(responseData);
            } catch (error) {
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};

exports.Order = async (req, res) => {

    const zohoApiBaseUrlforOrder = `${process.env.ZOHO_CRM_V5_URL}/Sales_Orders`;

    try {
        const accessToken = req.headers.authorization.split(" ")[1];
        const decryptToken = decryptAccessToken(accessToken, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforOrder, removeTags(JSON.stringify(req.body)), {
            headers: getZohoHeaders(decryptToken)
        });
        if (response.status === 200 || response.status === 201) {
            const responseData = response.data;
            if (responseData && responseData.data && responseData.data[0].details.id) {
                const userId = responseData.data[0].details.id;
                const getUserUrl = `${zohoApiBaseUrlforOrder}/${userId}`;
                const getUserResponse = await axios.get(getUserUrl, {
                    headers: getZohoHeaders(decryptToken)
                });

                if (getUserResponse.status === 200) {
                    return res.status(getUserResponse.status).send(getUserResponse.data);
                } else {
                    return res.status(getUserResponse.status).json({ message: req.t("ORDER_FETCH_DATA_FAILED") });
                }
            }
        } else {
            return res.status(response.status).json({ message: req.t("FAILED_ORDER") });
        }
    } catch (error) {
        if (
            error.response &&
            STATUS_CODE.includes(error.response.status) &&
            STATUS_ERROR.includes(error.response.data.code)
        ) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const responseData = await CommonFunForCatch(zohoApiBaseUrlforOrder, 'post', `${decryptToken}`, removeTags(JSON.stringify(req.body)));
                return res.status(200).send(responseData);
            } catch (error) {
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};

exports.Invoice = async (req, res) => {

    const zohoApiBaseUrlforInvoice = `${process.env.ZOHO_CRM_V5_URL}/Invoices`;

    try {
        const accessToken = req.headers.authorization.split(" ")[1];
        const decryptToken = decryptAccessToken(accessToken, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforInvoice, removeTags(JSON.stringify(req.body)), {
            headers: getZohoHeaders(decryptToken)
        });
        if (response.status === 200 || response.status === 201) {
            const responseData = response.data;
            if (responseData && responseData.data && responseData.data[0].details.id) {
                const userId = responseData.data[0].details.id;
                const getUserUrl = `${zohoApiBaseUrlforInvoice}/${userId}`;
                const getUserResponse = await axios.get(getUserUrl, {
                    headers: getZohoHeaders(decryptToken)
                });
                if (getUserResponse.status === 200 || getUserResponse.status === 201) {

                    const userResponseData = getUserResponse.data;
                    const invoiceData = userResponseData.data[0];
                    const mailgun = new Mailgun(formData);
                    const client = mailgun.client({
                        username: 'api',
                        key: process.env.API_KEY,
                        url: process.env.MAILGUN_URL
                    });
                    const ejsTemplatePath = path.join(__dirname, "./pdfIndex.ejs");
                    const templateContent = fs.readFileSync(ejsTemplatePath, "utf8");
                    const renderedHtml = ejs.render(templateContent, {
                        Invoices: {
                            CustomerName: invoiceData.First_Name.name,
                            LastName: invoiceData.Last_Name,
                            InvoiceDate: invoiceData.Invoice_Date,
                            InvoiceNumber: invoiceData.Invoice_Number,
                            BillingStreet: invoiceData.Billing_Street,
                            BillingCity: invoiceData.Billing_City,
                            BillingProvince: invoiceData.Billing_State,
                            BillingCountry: invoiceData.Billing_Country,
                            BillingCode: invoiceData.Billing_Code,
                            Status: invoiceData.Status,
                            ProductName: invoiceData.Invoiced_Items[0].Product_Name.name,
                            Quantity: invoiceData.Invoiced_Items[0].Quantity,
                            Tax: invoiceData.Invoiced_Items[0].Tax,
                            ListPrice: invoiceData.Invoiced_Items[0].List_Price,
                            Price: invoiceData.Invoiced_Items[0].Total,
                            Amount: invoiceData.Invoiced_Items[0].List_Price,
                            SubTotal: invoiceData.Sub_Total,
                            GrandTotal: invoiceData.Grand_Total
                        }
                    });
                    const browser = await puppeteer.launch({ headless: "new" });
                    const page = await browser.newPage();
                    await page.setContent(renderedHtml);
                    const pdfBuffer = await page.pdf();
                    await browser.close();

                    const htmlTemplatePath = path.join(__dirname, "./pdfIndextext.ejs");
                    const htmltemplateContent = fs.readFileSync(htmlTemplatePath, "utf8");
                    const html = ejs.render(htmltemplateContent, {
                        Invoices: {
                            CustomerName: invoiceData.First_Name.name,
                            LastName: invoiceData.Last_Name,
                            Amount: invoiceData.Invoiced_Items[0].Total,
                        }
                    })

                    const messageData = {
                        from: `Co-Bloc <Co-Bloc@${process.env.DOMAIN}>`,
                        to: invoiceData?.Customer_Email,
                        subject: `New Invoice from Co-Bloc #${invoiceData.Invoice_Number}`,
                        html: html,
                        attachment: [
                            {
                                data: pdfBuffer,
                                filename: `${invoiceData?.Invoice_Number}.pdf`,
                            },
                        ],
                    };

                    client.messages.create(process.env.DOMAIN, messageData)
                        .then((response) => {
                            console.log('Email sent successfully:', response);
                            return res.status(getUserResponse.status).send(getUserResponse.data);
                        })
                        .catch((err) => {
                            console.log('Error sending email', err);
                            return res.status(getUserResponse.status).send(getUserResponse.data);
                        })
                } else {
                    return res.status(getUserResponse.status).json({ message: req.t("INVOICE_FETCH_DATA_FAILED") });
                }
            }
        } else {
            return res.status(response.status).json({ message: req.t("FAILED_INVOICE") });
        }
    } catch (error) {
        if (
            error.response &&
            STATUS_CODE.includes(error.response.status) &&
            STATUS_ERROR.includes(error.response.data.code)
        ) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const responseData = await CommonFunForCatch(zohoApiBaseUrlforInvoice, 'post', `${decryptToken}`, removeTags(JSON.stringify(req.body)));
                return res.status(200).send(responseData);
            } catch (error) {
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};

exports.Support = async (req, res) => {

    const zohoApiBaseUrlForSupport = `${process.env.ZOHO_CRM_V5_URL}/Support`;
    const zohoApiBaseUrl = `${process.env.ZOHO_CRM_V2_URL}/Customer`;

    try {
        const accessToken = req.headers.authorization.split(" ")[1];
        const decryptToken = decryptAccessToken(accessToken, process.env.SECRET_KEY);

        const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
            headers: getZohoHeaders(decryptToken)
        });
        const requestType = checkUserResponse.status === 200 ? "Comment" : "New Ticket";

        req.body.data[0].Request_Type = [requestType];

        const response = await axios.post(zohoApiBaseUrlForSupport, removeTags(JSON.stringify(req.body)), {
            headers: getZohoHeaders(decryptToken)
        });
        if (response.status === 200 || response.status === 201) {
            return res.status(response.status).send({ ...response.data, message: req.t("SUPPORT_MESSAGE") });
        }
        else {
            return res.status(response.status).json({ message: req.t("FAILED_SUPPORT") });
        }

    } catch (error) {
        if (
            error.response &&
            STATUS_CODE.includes(error.response.status) &&
            STATUS_ERROR.includes(error.response.data.code)
        ) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
                headers: getZohoHeaders(decryptToken)
            });
            const requestType = checkUserResponse.status === 200 ? "Comment" : "New Ticket";

            req.body.data[0].Request_Type = [requestType];

            try {
                const responseData = await CommonFunForCatch(zohoApiBaseUrlForSupport, 'post', `${decryptToken}`, removeTags(JSON.stringify(req.body)));
                return res.status(200).json({ data: responseData, message: req.t("SUPPORT_MESSAGE") });
            } catch (error) {
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};

// this function is to truncate the additional decimal points
function truncateToDecimals(num, dec = 2) {
    const calcDec = Math.pow(10, dec);
    return Math.trunc(num * calcDec) / calcDec;
}

var tagBody = '(?:[^"\'>]|"[^"]*"|\'[^\']*\')*';

var tagOrComment = new RegExp(
    '<(?:'
    + '!--(?:(?:-*[^->])*--+|-?)'
    + '|/?[a-z]'
    + tagBody
    + ')>',
    'gi');

function removeTags(html) {
    var oldHtml;
    do {
        oldHtml = html;
        html = html.replace(tagOrComment, '');
        html = html.replace(/alert\('(.+?)'\)/g, '$1');
    } while (html !== oldHtml);
    return html.replace(/</g, '&lt;');
};