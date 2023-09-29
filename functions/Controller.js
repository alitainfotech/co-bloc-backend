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
const {
    STATUS_CODE,
    STATUS_ERROR,
    SUPPORT_REQUEST,
    REFRESH_TOKEN
} = require("./commonConstant");
const {
    decryptAccessToken,
    getZohoHeaders,
    refreshAccessToken,
    commonFunForCatch,
    truncateToDecimals,
    sanitizeHtml,
    dataSendWithMail
} = require('./services/commonFuncions');



exports.RefreshAccessToken = async (req, res) => {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
    const refreshTokenURL = `${process.env.REFRESH_TOKEN_URL}/token`;
    const grantType = REFRESH_TOKEN

    const data = {
        grant_type: grantType,
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

    const userData = req.body.data[0];

    let dataHTML = `<h1>Customer Details</h1>
    <p><strong>Name:</strong> ${userData.Name}</p>
    <p><strong>Last Name:</strong> ${userData.Last_Name}</p>
    <p><strong>Email:</strong> ${userData.Email}</p>
    <p><strong>Phone Number:</strong> ${userData.Phone_Number}</p>
    <p><strong>Address Line:</strong> ${userData.Address_Line}</p>
    <p><strong>Country:</strong> ${userData.Country}</p>
    <p><strong>Zip Code:</strong> ${userData.Zip_Code}</p>
    <p><strong>City:</strong> ${userData.City}</p> `

    let subject = "Customers Details"

    try {
        const decryptToken = decryptAccessToken(req, process.env.SECRET_KEY);

        const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
            headers: getZohoHeaders(decryptToken)
        });

        if (checkUserResponse.status !== 200) {

            const response = await axios.post(zohoApiBaseUrl, sanitizeHtml(JSON.stringify(req.body)), {
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
                    const responseData = await commonFunForCatch(zohoApiBaseUrl, 'post', `${decryptToken}`, sanitizeHtml(JSON.stringify(req.body)));
                    return res.status(200).send(responseData);
                } else {
                    return res.status(checkUserResponse.status).json(checkUserResponse.data);
                }
            } catch (error) {
                await dataSendWithMail(dataHTML, subject)
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            await dataSendWithMail(dataHTML, subject)
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};


exports.Payment = async (req, res) => {

    const zohoApiBaseUrlforPayment = `${process.env.ZOHO_CRM_V2_URL}/Payment`;

    const userData = req.body.data[0];

    let dataHTML = `
            <h1>Payment Details</h1>
            <p><strong>Payment Name:</strong> ${userData.Name}</p>
            <p><strong>Order ID:</strong> ${userData.Order_Id}</p>
            <p><strong>Amount:</strong> ${userData.Amount} </p>
            <p><strong>Payment Currency:</strong> ${userData.Payment_Currency}</p>
            <p><strong>Payment Status:</strong> ${userData.Payment_Status}</p>
        `

    let subject = "Payment Details"

    try {
        const decryptToken = decryptAccessToken(req, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforPayment, sanitizeHtml(JSON.stringify(req.body)), {
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
                const responseData = await commonFunForCatch(zohoApiBaseUrlforPayment, 'post', `${decryptToken}`, sanitizeHtml(JSON.stringify(req.body)));
                return res.status(200).send(responseData);
            } catch (error) {
                await dataSendWithMail(dataHTML, subject);
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            await dataSendWithMail(dataHTML, subject);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};

exports.Order = async (req, res) => {

    const zohoApiBaseUrlforOrder = `${process.env.ZOHO_CRM_V5_URL}/Sales_Orders`;

    const userData = req.body.data[0];

    let dataHTML = `
            <h1>Order Details</h1>
            <p><strong>Quantity:</strong> ${userData.Ordered_Items[0].Quantity}</p>
            <p><strong>Payment Currency:</strong> ${userData.Payment_Currency}</p>
            <p><strong>Billing Country:</strong> ${userData.Billing_Country} </p>
            <p><strong>Billing City:</strong> ${userData.Billing_City}</p>
            <p><strong>Billing Street:</strong> ${userData.Billing_Street}</p>
            <p><strong>Billing Code:</strong> ${userData.Billing_Code}</p>
        `

    let subject = "Order Details"

    try {
        const decryptToken = decryptAccessToken(req, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforOrder, sanitizeHtml(JSON.stringify(req.body)), {
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
                const responseData = await commonFunForCatch(zohoApiBaseUrlforOrder, 'post', `${decryptToken}`, sanitizeHtml(JSON.stringify(req.body)));
                return res.status(200).send(responseData);
            } catch (error) {
                await dataSendWithMail(dataHTML, subject);
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            await dataSendWithMail(dataHTML, subject);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};

exports.Invoice = async (req, res) => {

    const zohoApiBaseUrlforInvoice = `${process.env.ZOHO_CRM_V5_URL}/Invoices`;

    const userData = req.body.data[0];

    let dataHTML = `
            <h1>Invoice Details</h1>
            <p><strong>Invoice Date:</strong> ${userData.Invoice_Date}</p>
            <p><strong>Billing Country:</strong> ${userData.Billing_Country} </p>
            <p><strong>Billing City:</strong> ${userData.Billing_City}</p>
            <p><strong>Billing Street:</strong> ${userData.Billing_Street}</p>
            <p><strong>Billing Code:</strong> ${userData.Billing_Code}</p>
            <p><strong>Quantity:</strong> ${userData.Invoiced_Items[0].Quantity}</p>
            <p><strong>Subject:</strong> ${userData.Subject}</p>
            <p><strong>Account Name:</strong> ${userData.Account_Name}</p>
        `

    let subject = "Invoice Details"

    try {
        const decryptToken = decryptAccessToken(req, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforInvoice, sanitizeHtml(JSON.stringify(req.body)), {
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
                        username: process.env.MAILGUN_USERNAME,
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
                const responseData = await commonFunForCatch(zohoApiBaseUrlforInvoice, 'post', `${decryptToken}`, sanitizeHtml(JSON.stringify(req.body)));
                return res.status(200).send(responseData);
            } catch (error) {
                await dataSendWithMail(dataHTML, subject);
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            await dataSendWithMail(dataHTML, subject);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};

exports.Support = async (req, res) => {

    const zohoApiBaseUrlForSupport = `${process.env.ZOHO_CRM_V5_URL}/Support`;
    const zohoApiBaseUrl = `${process.env.ZOHO_CRM_V2_URL}/Customer`;

    const userData = req.body.data[0];

    let dataHTML = `
            <h1>Support Details</h1>
            <p><strong>Name:</strong> ${userData.Name}</p>
            <p><strong>Email:</strong> ${userData.Email} </p>
            <p><strong>Message:</strong> ${userData.Message}</p>
        `

    let subject = "Support Details"

    try {
        const decryptToken = decryptAccessToken(req, process.env.SECRET_KEY);

        const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
            headers: getZohoHeaders(decryptToken)
        });
        const requestType = checkUserResponse.status === 200 ? SUPPORT_REQUEST.COMMENT : SUPPORT_REQUEST.NEW_TICKET;

        req.body.data[0].Request_Type = [requestType];

        const response = await axios.post(zohoApiBaseUrlForSupport, sanitizeHtml(JSON.stringify(req.body)), {
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
            const decryptToken = await decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
                headers: getZohoHeaders(decryptToken)
            });
            const requestType = checkUserResponse.status === 200 ? SUPPORT_REQUEST.COMMENT : SUPPORT_REQUEST.NEW_TICKET;

            req.body.data[0].Request_Type = [requestType];

            try {
                const responseData = await commonFunForCatch(zohoApiBaseUrlForSupport, 'post', `${decryptToken}`, sanitizeHtml(JSON.stringify(req.body)));
                return res.status(200).json({ data: responseData, message: req.t("SUPPORT_MESSAGE") });
            } catch (error) {
                await dataSendWithMail(dataHTML, subject);
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            await dataSendWithMail(dataHTML, subject);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};


exports.checkOrderId = async (req, res) => {

    const zohoApiBaseUrlforOrder = `${process.env.ZOHO_CRM_V5_URL}/Sales_Orders`;

    try {
        let decryptToken = decryptAccessToken(req, process.env.SECRET_KEY);

        const checkUserResponse = await axios.get(`${zohoApiBaseUrlforOrder}/search?criteria=(Order_Id:equals:${req.body.order_id})`, {
            headers: getZohoHeaders(decryptToken)
        });
        if (checkUserResponse.status === 200) {
            return res.json({ status: 200, data: { Order_Id: checkUserResponse?.data?.data[0].Order_Id } });
        }
        else {
            return res.json({ status: 204, data: null, message: req.t("WRONG_ORDER") });
        }

    } catch (error) {
        if (
            error.response &&
            STATUS_CODE.includes(error.response.status) &&
            STATUS_ERROR.includes(error.response.data.code)
        ) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = await decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            const checkUserResponse = await axios.get(`${zohoApiBaseUrlforOrder}/search?criteria=(Order_Id:equals:${req.body.order_id})`, {
                headers: getZohoHeaders(decryptToken)
            });

            if (checkUserResponse.status === 200 || checkUserResponse.status === 201) {
                return res.json({ status: 200, data: checkUserResponse?.data?.data[0].Order_Id });
            } else {
                return res.json({ status: 204, data: null, message: req.t("WRONG_ORDER") });
            }
        } else {
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};


exports.checkEmail = async (req, res) => {
    const zohoApiBaseUrl = `${process.env.ZOHO_CRM_V2_URL}/Customer`;

    try {
        let decryptToken = decryptAccessToken(req, process.env.SECRET_KEY);

        const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
            headers: getZohoHeaders(decryptToken)
        });
        if (checkUserResponse.status === 200) {
            return res.json({ status: 200, data: { isValid: true } });
        }
        else {
            return res.json({ status: 204, data: { isValid: false } });
        }
    } catch (error) {
        if (
            error.response &&
            STATUS_CODE.includes(error.response.status) &&
            STATUS_ERROR.includes(error.response.data.code)
        ) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = await decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
                headers: getZohoHeaders(decryptToken)
            });
            if (checkUserResponse.status === 200) {
                return res.json({ status: 200, data: { isValid: true } });
            }
            else {
                return res.json({ status: 204, data: { isValid: false } });
            }
        } else {
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
}