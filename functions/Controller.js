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
    dataSendWithMail,
    generateInvoicePDF,
    sendEmail
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
    const formData = userData.formData

    try {
        const decryptToken = await decryptAccessToken(req, process.env.SECRET_KEY);

        const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
            headers: getZohoHeaders(decryptToken)
        });

        if (checkUserResponse.status !== 200) {
            const response = await axios.post(zohoApiBaseUrl, sanitizeHtml(JSON.stringify({ ...req.body, formData: formData })), {
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
            const decryptToken = await decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
                    headers: getZohoHeaders(decryptToken)
                });
                if (checkUserResponse.status !== 200) {
                    const responseData = await commonFunForCatch(zohoApiBaseUrl, 'post', `${decryptToken}`, sanitizeHtml(JSON.stringify({ ...req.body, formData: formData })));
                    return res.status(200).send(responseData);
                } else {
                    return res.status(checkUserResponse.status).json(checkUserResponse.data);
                }
            } catch (error) {
                await dataSendWithMail(formData)
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            await dataSendWithMail(formData)
            console.log("error========>>", error);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};


exports.Payment = async (req, res) => {
    const zohoApiBaseUrlforPayment = `${process.env.ZOHO_CRM_V2_URL}/Payment`;

    const userData = req.body.data[0];
    const formData = userData.formData

    try {
        const decryptToken = await decryptAccessToken(req, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforPayment, sanitizeHtml(JSON.stringify({ ...req.body, formData: formData })), {
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
            const decryptToken = await decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const responseData = await commonFunForCatch(zohoApiBaseUrlforPayment, 'post', `${decryptToken}`, sanitizeHtml(JSON.stringify({ ...req.body, formData: formData })));
                return res.status(200).send(responseData);
            } catch (error) {
                await dataSendWithMail(formData);
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            await dataSendWithMail(formData);
            console.log("error========>>", error);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};

exports.Order = async (req, res) => {
    const zohoApiBaseUrlforOrder = `${process.env.ZOHO_CRM_V5_URL}/Sales_Orders`;

    const userData = req.body.data[0];
    const FormData = userData.formData

    try {
        const decryptToken = await decryptAccessToken(req, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforOrder, sanitizeHtml(JSON.stringify({ ...req.body, formData: FormData })), {
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
            const decryptToken = await decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const responseData = await commonFunForCatch(zohoApiBaseUrlforOrder, 'post', `${decryptToken}`, sanitizeHtml(JSON.stringify({ ...req.body, formData: FormData })));
                return res.status(200).send(responseData);
            } catch (error) {
                await dataSendWithMail(FormData);
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            await dataSendWithMail(FormData);
            console.log("error========>>", error);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};

exports.Invoice = async (req, res) => {
    const zohoApiBaseUrlforInvoice = `${process.env.ZOHO_CRM_V5_URL}/Invoices`;

    const userData = req.body.data[0];
    const FormData = userData.formData

    try {
        const decryptToken = await decryptAccessToken(req, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforInvoice, sanitizeHtml(JSON.stringify({ ...req.body, formData: FormData })), {
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

                    const pdfBuffer = await generateInvoicePDF(invoiceData);

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
            const decryptToken = await decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const responseData = await commonFunForCatch(zohoApiBaseUrlforInvoice, 'post', `${decryptToken}`, sanitizeHtml(JSON.stringify({ ...req.body, formData: FormData })));
                return res.status(200).send(responseData);
            } catch (error) {
                await dataSendWithMail(FormData);
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            await dataSendWithMail(FormData);
            console.log("error----------->", error);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};

exports.Support = async (req, res) => {

    const zohoApiBaseUrlForSupport = `${process.env.ZOHO_CRM_V5_URL}/Support`;

    try {
        const decryptToken = await decryptAccessToken(req, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlForSupport, sanitizeHtml(JSON.stringify(req.body)), {
            headers: getZohoHeaders(decryptToken)
        });
        if (response.status === 200 || response.status === 201) {
            const responseData = response.data;
            if (responseData && responseData.data && responseData.data[0].details.id) {
                const userId = responseData.data[0].details.id;
                const getUserUrl = `${zohoApiBaseUrlForSupport}/${userId}`;
                const getUserResponse = await axios.get(getUserUrl, {
                    headers: getZohoHeaders(decryptToken)
                });

                if (getUserResponse.status === 200) {
                    return res.status(getUserResponse.status).send({ ...getUserResponse.data, message: req.t("SUPPORT_MESSAGE") });
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
            const decryptToken = await decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const responseData = await commonFunForCatch(zohoApiBaseUrlForSupport, 'post', `${decryptToken}`, sanitizeHtml(JSON.stringify(req.body)));
                return res.status(200).json({ data: responseData, message: req.t("SUPPORT_MESSAGE") });
            } catch (error) {
                return res.status(500).json({ message: req.t("CATCH_ERROR") });
            }
        } else {
            console.log("error========>>", error);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};


exports.checkOrderIdandSONumber = async (req, res) => {
    const zohoApiBaseUrlforOrder = `${process.env.ZOHO_CRM_V5_URL}/Sales_Orders`;

    try {
        const decryptToken = await decryptAccessToken(req, process.env.SECRET_KEY);

        const searchCriteria = `(Order_Id:equals:${req.body.order_id}) and (SO_Number:equals:${req.body.so_number})`;

        const checkUserResponse = await axios.get(`${zohoApiBaseUrlforOrder}/search?criteria=${searchCriteria}`, {
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

            const searchCriteria = `(Order_Id:equals:${req.body.order_id}) and (SO_Number:equals:${req.body.so_number})`;

            const checkUserResponse = await axios.get(`${zohoApiBaseUrlforOrder}/search?criteria=${searchCriteria}`, {
                headers: getZohoHeaders(decryptToken)
            });

            if (checkUserResponse.status === 200 || checkUserResponse.status === 201) {
                return res.json({ status: 200, data: checkUserResponse?.data?.data[0].Order_Id });
            } else {
                return res.json({ status: 204, data: null, message: req.t("WRONG_ORDER") });
            }
        } else {
            console.log("error========>>", error);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
};


exports.checkEmail = async (req, res) => {
    const zohoApiBaseUrl = `${process.env.ZOHO_CRM_V2_URL}/Customer`;

    try {
        let decryptToken = await decryptAccessToken(req, process.env.SECRET_KEY);

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
            console.log("error========>>", error);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });
        }
    }
}

exports.ZohoWebhook = async (req, res) => {
    const zohoApiBaseUrlforOrder = `${process.env.ZOHO_CRM_V5_URL}/Sales_Orders`;
    try {
        const orderId = req.body.OrderId;
        if (!orderId) {
            return res.status(400).json({ message: req.t("BAD_REQUEST") });
        }
        const newAccessToken = await refreshAccessToken();

        const decryptToken = await decryptAccessToken(newAccessToken, process.env.SECRET_KEY);
        const response = await axios.get(`${zohoApiBaseUrlforOrder}/${orderId}`, {
            headers: getZohoHeaders(decryptToken)
        });
        const responseData = response.data.data[0]


        // Order Confirmation EJS
        const htmlTemplatePath = path.join(__dirname, "./orderConfirmation.ejs");
        const htmltemplateContent = fs.readFileSync(htmlTemplatePath, "utf8");

        const html = ejs.render(htmltemplateContent, {
            Customer_Name: responseData.Customer_Name.name,
            Billing_Street: responseData.Billing_Street,
            Billing_City: responseData.Billing_City,
            Billing_Country: responseData.Billing_Country,
            ShippingFirstName: responseData.Shipping_First_Name,
            ShippingStreet: responseData.Shipping_Street,
            ShippingCity: responseData.Shipping_City,
            ShippingCountry: responseData.Shipping_Country,
        })

        const messageData = {
            from: `Co-Bloc <Co-Bloc@${process.env.DOMAIN}>`,
            to: responseData.Email,
            subject: `Order Shipment Notification for Your Co-bloc Game`,
            html: html
        }

        // Order Shipping Sticker EJS
        const htmlTemplatePathForShipping = path.join(__dirname, "./shippingSticker.ejs");
        const htmltemplateContentForShipping = fs.readFileSync(htmlTemplatePathForShipping, "utf8");

        const htmlForShipping = ejs.render(htmltemplateContentForShipping, {
            Customer_Name: responseData.Customer_Name.name,
            Billing_Street: responseData.Billing_Street,
            Billing_City: responseData.Billing_City,
            ShippingFirstName: responseData.Shipping_First_Name,
            ShippingStreet: responseData.Shipping_Street,
            ShippingCity: responseData.Shipping_City,
            OrderNumber: responseData.Order_Id
        })

        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        await page.setContent(htmlForShipping);
        const pdfBuffer = await page.pdf();
        await browser.close();

        const mailgun = new Mailgun(formData);
        const client = mailgun.client({
            username: process.env.MAILGUN_USERNAME,
            key: process.env.API_KEY,
            url: process.env.MAILGUN_URL
        });

        const messageDataForShipping = {
            from: `Co-Bloc <Co-Bloc@${process.env.DOMAIN}>`,
            to: "info@entertainment-lab.fr",
            subject: `Order Shipping Sticker Notification`,
            html: 'Your shipping notification message',
            attachment: [
                {
                    data: pdfBuffer,
                    filename: `${responseData?.Order_Id} Order Shipping.pdf`,
                },
            ],
        }

        await sendEmail(client, messageData, 'Email sent successfully:');
        await sendEmail(client, messageDataForShipping, 'Shipping email sent successfully:');

        return res.status(200).send('Emails sent successfully');
    }
    catch (error) {
        console.log("***************** Order send webshook error: *******************", error);
        return res.status(500).json({ message: req.t("CATCH_ERROR") });
    }
};

exports.DownloadInvoice = async (req, res) => {
    const zohoApiBaseUrlforInvoice = `${process.env.ZOHO_CRM_V5_URL}/Invoices`;

    try {
        const decryptToken = await decryptAccessToken(req, process.env.SECRET_KEY);

        const searchCriteria = `(Order_Id:equals:${req.body.order_id}) and (SO_Number:equals:${req.body.so_number})`;

        const checkUserResponse = await axios.get(`${zohoApiBaseUrlforInvoice}/search?criteria=${searchCriteria}`, {
            headers: getZohoHeaders(decryptToken)
        });
        if (checkUserResponse.status === 200) {
            const responseData = checkUserResponse.data;
            if (responseData && responseData.data && responseData.data[0].id) {
                const userId = responseData.data[0].id;
                const getUserUrl = `${zohoApiBaseUrlforInvoice}/${userId}`;
                const getUserResponse = await axios.get(getUserUrl, {
                    headers: getZohoHeaders(decryptToken)
                });
                if (getUserResponse.status === 200) {
                    const userResponseData = getUserResponse.data;
                    const invoiceData = userResponseData.data[0];

                    const pdfBuffer = await generateInvoicePDF(invoiceData);

                    const pdfFileName = `${invoiceData?.Invoice_Number}.pdf`;

                    const pdfBase64 = pdfBuffer.toString("base64");

                    return res.json({
                        status: getUserResponse.status,
                        message: "Invoice PDF generate successfully",
                        data: { pdfBase64, pdfFileName }
                    });
                } else {
                    return res.json({ status: 204, data: null, message: req.t("WRONG_ORDER") });
                }
            }
        } else {
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

            const searchCriteria = `(Order_Id:equals:${req.body.order_id}) and (SO_Number:equals:${req.body.so_number})`;

            const checkUserResponse = await axios.get(`${zohoApiBaseUrlforInvoice}/search?criteria=${searchCriteria}`, {
                headers: getZohoHeaders(decryptToken)
            });

            if (checkUserResponse.status === 200 || checkUserResponse.status === 201) {
                const responseData = checkUserResponse.data;
                if (responseData && responseData.data && responseData.data[0].id) {
                    const userId = responseData.data[0].id;
                    const getUserUrl = `${zohoApiBaseUrlforInvoice}/${userId}`;
                    const getUserResponse = await axios.get(getUserUrl, {
                        headers: getZohoHeaders(decryptToken)
                    });
                    if (getUserResponse.status === 200) {
                        const userResponseData = getUserResponse.data;
                        const invoiceData = userResponseData.data[0];

                        const pdfBuffer = await generateInvoicePDF(invoiceData);

                        const pdfFileName = `${invoiceData?.Invoice_Number}.pdf`;

                        const pdfBase64 = pdfBuffer.toString("base64");

                        return res.json({
                            status: getUserResponse.status,
                            message: "Invoice PDF generate successfully",
                            data: { pdfBase64, pdfFileName }
                        });
                    } else {
                        return res.json({ status: 204, data: null, message: req.t("WRONG_ORDER") });
                    }
                }
            } else {
                return res.json({ status: 204, data: null, message: req.t("WRONG_ORDER") });
            }
        } else {
            console.log("error========>>", error);
            return res.status(500).json({ message: req.t("CATCH_ERROR") });

        }
    }
}