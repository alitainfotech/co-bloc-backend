const Mailgun = require('mailgun.js');
const formData = require('form-data');
const fs = require('fs');
const puppeteer = require("puppeteer");
const ejs = require("ejs")
const axios = require("axios");
const path = require('path');
var CryptoJS = require("crypto-js");
const cron = require("node-cron")
require("dotenv").config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    const refreshTokenURL = 'https://accounts.zoho.eu/oauth/v2/token';

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
            throw new Error('Error refreshing access token');
        }
    } catch (error) {
        console.error('Error refreshing access token:', error);
        throw new Error('Error refreshing access token');
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

    const zohoApiBaseUrl = 'https://www.zohoapis.eu/crm/v2/Customer';

    try {
        const accessToken = req.headers.authorization.split(" ")[1];
        const decryptToken = decryptAccessToken(accessToken, process.env.SECRET_KEY);

        const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
            headers: getZohoHeaders(decryptToken)
        });

        if (checkUserResponse.status !== 200) {
            const response = await axios.post(zohoApiBaseUrl, JSON.stringify(req.body), {
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
        console.log(error);
        if (error.response && (error.response.status === 401 || error.response.data.code === 'INVALID_TOKEN')) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
                    headers: getZohoHeaders(decryptToken)
                });
                if (checkUserResponse.status !== 200) {
                    const responseData = await CommonFunForCatch(zohoApiBaseUrl, 'post', `${decryptToken}`, JSON.stringify(req.body));
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

    const zohoApiBaseUrlforPayment = 'https://www.zohoapis.eu/crm/v2/Payment';

    try {
        const accessToken = req.headers.authorization.split(" ")[1];
        const decryptToken = decryptAccessToken(accessToken, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforPayment, JSON.stringify(req.body), {
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
        if (error.response && (error.response.status === 401 || error.response.data.code === 'INVALID_TOKEN')) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const responseData = await CommonFunForCatch(zohoApiBaseUrlforPayment, 'post', `${decryptToken}`, JSON.stringify(req.body));
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

    const zohoApiBaseUrlforOrder = 'https://www.zohoapis.eu/crm/v5/Sales_Orders';

    try {
        const accessToken = req.headers.authorization.split(" ")[1];
        const decryptToken = decryptAccessToken(accessToken, process.env.SECRET_KEY);

        const response = await axios.post(zohoApiBaseUrlforOrder, JSON.stringify(req.body), {
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
        if (error.response && (error.response.status === 401 || error.response.data.code === 'INVALID_TOKEN')) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const responseData = await CommonFunForCatch(zohoApiBaseUrlforOrder, 'post', `${decryptToken}`, JSON.stringify(req.body));
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

    const zohoApiBaseUrlforInvoice = 'https://www.zohoapis.eu/crm/v5/Invoices';

    try {
        // console.log("tryyyyyyyyyyyyyyyyyy");
        const accessToken = req.headers.authorization.split(" ")[1];
        const decryptToken = decryptAccessToken(accessToken, process.env.SECRET_KEY);
        console.log("decryptToken",decryptToken);

        const response = await axios.post(zohoApiBaseUrlforInvoice, JSON.stringify(req.body), {
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
                    const client = mailgun.client({ username: 'api', key: process.env.API_KEY });
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
                        from: 'Co-Bloc <Co-Bloc@sandbox8cedf9164931462c9062c66b668ed948.mailgun.org>',
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
        // console.log(error);
        if (error.response && (error.response.status === 401 || error.response.data.code === 'INVALID_TOKEN')) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            try {
                const responseData = await CommonFunForCatch(zohoApiBaseUrlforInvoice, 'post', `${decryptToken}`, JSON.stringify(req.body));
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

    const zohoApiBaseUrlForSupport = 'https://www.zohoapis.eu/crm/v5/Support';
    const zohoApiBaseUrl = 'https://www.zohoapis.eu/crm/v2/Customer';

    try {
        const accessToken = req.headers.authorization.split(" ")[1];
        const decryptToken = decryptAccessToken(accessToken, process.env.SECRET_KEY);

        const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
            headers: getZohoHeaders(decryptToken)
        });
        const requestType = checkUserResponse.status === 200 ? "Comment" : "New Ticket";

        req.body.data[0].Request_Type = [requestType];

        const response = await axios.post(zohoApiBaseUrlForSupport, JSON.stringify(req.body), {
            headers: getZohoHeaders(decryptToken)
        });
        if (response.status === 200 || response.status === 201) {
            return res.status(response.status).send(response.data);
        }
        else {
            return res.status(response.status).json({ message: req.t("FAILED_SUPPORT") });
        }

    } catch (error) {
        if (error.response && (error.response.status === 401 || error.response.data.code === 'INVALID_TOKEN')) {
            const newAccessToken = await refreshAccessToken();
            const decryptToken = decryptAccessToken(newAccessToken, process.env.SECRET_KEY);

            const checkUserResponse = await axios.get(`${zohoApiBaseUrl}/search?criteria=(Email:equals:${req.body.data[0].Email})`, {
                headers: getZohoHeaders(decryptToken)
            });
            const requestType = checkUserResponse.status === 200 ? "Comment" : "New Ticket";

            req.body.data[0].Request_Type = [requestType];

            try {
                const responseData = await CommonFunForCatch(zohoApiBaseUrlForSupport, 'post', `${decryptToken}`, JSON.stringify(req.body));
                return res.status(200).send(responseData);
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

// function yourTask() {
//     const currentDate = new Date();
//     console.log("currentDate",currentDate);
//     const targetDate = new Date();
//     console.log("targetDate",targetDate);
//     const aa = targetDate.setDate(currentDate.getDate() + 21);
//     console.log("Next Date",aa);

//     if (currentDate <= targetDate) {

//         console.log('Running your task.');
//     } else {
//         console.log('Exiting.');
//         process.exit();
//     }
// }


// cron.schedule("*/1 * * * *", async () => {
//     try {
//         console.log("Cron job Started");
//         await yourTask();
//         console.log("Cron job ran successfully.");
//     } catch (error) {
//         console.error('Error executing cron job:', error);
//     }
// });

// const nodemailer = require('nodemailer');
// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//       user: 'test.alitainfotech@gmail.com',
//       pass: 'bwwrprvjtgnzgssl',
//     },
//   });
  
//   const zohoApiUrl = 'https://www.zohoapis.eu/crm/v2/Customer';
  
//   async function fetchUsersAddedToday() {
//     try {
//       const response = await axios.get(zohoApiUrl, {
//         headers: {
//           'Authorization': 'Zoho-oauthtoken 1000.48abb00ecb61cde963f21a7afabe9c63.af0b2f72926fb4ceb1a783907057fb24',
//         },
//       });
  
//       const users = response.data;

//     //   if (!Array.isArray(users)) {
//     //     console.error('API response does not contain an array of users:', users);
//     //     throw new Error('Invalid API response');
//     //   }
//     // const users = Array.isArray(response.data) ? response.data : response.data.users;

//     if (!Array.isArray(users)) {
//         console.error('API response does not contain an array of users:', users);
//         throw new Error('Invalid API response');
//       }

//       const today = new Date();
//       const usersAddedToday = users.filter(user => {
//         const userDate = new Date(user.addedDate); // Adjust the property name accordingly
//         return userDate.getDate() === today.getDate() &&
//           userDate.getMonth() === today.getMonth() &&
//           userDate.getFullYear() === today.getFullYear();
//       });
  
//       return usersAddedToday.length;
//     } catch (error) {
//       console.error('Error fetching user data:', error);
//       throw error;
//     }
//   }
  
//   async function sendEmail() {
//     const usersCount = await fetchUsersAddedToday();
  
//     // Check if it's 12 PM
//     const currentHour = new Date().getHours();
//     if (currentHour === 12) {
//       const mailOptions = {
//         from: 'test.alitainfotech@gmail.com',
//         to: 'yaman.alitainfotech@gmail.com',
//         subject: 'Users Added Today',
//         text: `Number of users added today: ${usersCount}`,
//       };
  
//       // Send the email
//       transporter.sendMail(mailOptions, (error, info) => {
//         if (error) {
//           console.error('Error sending email:', error);
//         } else {
//           console.log('Email sent:', info.response);
//         }
//       });
//     }
//   }
  
//   cron.schedule('*/1 * * * *', async () => {
//     try {
//       console.log('Cron job started');
//       await sendEmail();
//       console.log('Cron job ran successfully.');
//     } catch (error) {
//       console.error('Error executing cron job:', error);
//     }
//   });