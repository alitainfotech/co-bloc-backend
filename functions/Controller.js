const express = require("express");
const functions = require("firebase-functions");
const bodyParser = require("body-parser");
const cors = require("cors");
const Mailgun = require("mailgun.js");
const formData = require("form-data");
const fs = require("fs");
const puppeteer = require("puppeteer");
const ejs = require("ejs");
const axios = require("axios");
require("dotenv").config();

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const path = require("path");
const { log } = require("console");
const { decrypt } = require("dotenv");
var CryptoJS = require("crypto-js");

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(
  cors({
    origin: "*",
  })
);

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.RefreshAccessToken = async (req, res) => {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const refreshTokenURL = "https://accounts.zoho.eu/oauth/v2/token";

  const data = {
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  };

  try {
    const response = await axios.post(refreshTokenURL, null, {
      params: data,
      headers: {
        "Content-Type": "application/json",
      },
    });
    const responseData = response.data;

    if (responseData.access_token) {
      const accessToken = responseData.access_token;
      let bcryptToken = CryptoJS.AES.encrypt(
        accessToken,
        process.env.SECRET_KEY
      ).toString();
      res.json({ accessToken: bcryptToken });
    } else {
      console.error("Error refreshing access token. Response:", responseData);
      throw new Error("Error refreshing access token");
    }
  } catch (error) {
    console.error("Error refreshing access token:", error);
    throw new Error("Error refreshing access token");
  }
};

async function CommonFunForCatch(
  url,
  method,
  decryptToken,
  requestData = null
) {
  const headers = {
    Authorization: `Zoho-oauthtoken ${decryptToken}`,
    "Content-Type": "application/json",
  };

  try {
    const response = await axios({ url, method, headers, data: requestData });

    if (response.status === 200 || response.status === 201) {
      const responseData = response.data;
      if (
        responseData &&
        responseData.data &&
        responseData.data[0].details.id
      ) {
        const userId = responseData.data[0].details.id;
        const getUserUrl = `${url}/${userId}`;
        const getUserResponse = await axios.get(getUserUrl, { headers });

        if (getUserResponse.status === 200) {
          return getUserResponse.data;
        } else {
          throw new Error("Failed to fetch user data");
        }
      } else {
        throw new Error("User added, but ID not found in response");
      }
    } else {
      throw new Error("Failed to create user in Zoho CRM");
    }
  } catch (error) {
    throw error;
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
      .send({ error: "An error occurred while processing your payment." });
  }
};

const zohoApiBaseUrl = "https://www.zohoapis.eu/crm/v2/Customer";

exports.addUser = async (req, res) => {
  try {
    const accessToken = req.headers.authorization.split(" ");

    var bytes = CryptoJS.AES.decrypt(accessToken[1], process.env.SECRET_KEY);
    var decryptToken = bytes.toString(CryptoJS.enc.Utf8);
    const response = await axios.post(
      zohoApiBaseUrl,
      JSON.stringify(req.body),
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${decryptToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (response.status === 200 || response.status === 201) {
      const responseData = response.data;
      if (
        responseData &&
        responseData.data &&
        responseData.data[0].details.id
      ) {
        const userId = responseData.data[0].details.id;
        const getUserUrl = `${zohoApiBaseUrl}/${userId}`;
        const getUserResponse = await axios.get(getUserUrl, {
          headers: {
            Authorization: `Zoho-oauthtoken ${decryptToken}`,
            "Content-Type": "application/json",
          },
        });

        if (getUserResponse.status === 200) {
          res.status(getUserResponse.status).send(getUserResponse.data);
        } else {
          res
            .status(getUserResponse.status)
            .json({ message: "Failed to fetch user data" });
        }
      } else {
        res
          .status(response.status)
          .json({ message: "User added, but ID not found in response" });
      }
    } else {
      res
        .status(response.status)
        .json({ message: "Failed to create user in Zoho CRM" });
    }
  } catch (error) {
    if (
      error.response.status === 401 ||
      error.response.data.code === "INVALID_TOKEN"
    ) {
      const newAccessToken = await refreshAccessToken();
      var bytes = CryptoJS.AES.decrypt(newAccessToken, process.env.SECRET_KEY);
      var decryptToken = bytes.toString(CryptoJS.enc.Utf8);

      try {
        const responseData = await CommonFunForCatch(
          zohoApiBaseUrl,
          "post",
          `${decryptToken}`,
          JSON.stringify(req.body)
        );
        res.status(200).send(responseData);
      } catch (error) {
        res.status(500).json({
          message: "An error occurred while interacting with Zoho CRM",
        });
      }
    } else {
      res
        .status(500)
        .json({ message: "An error occurred while interacting with Zoho CRM" });
    }
  }
};

const zohoApiBaseUrlforPayment = "https://www.zohoapis.eu/crm/v2/Payment";

exports.Payment = async (req, res) => {
  try {
    const accessToken = req.headers.authorization.split(" ");

    var bytes = CryptoJS.AES.decrypt(accessToken[1], process.env.SECRET_KEY);
    var decryptToken = bytes.toString(CryptoJS.enc.Utf8);

    const response = await axios.post(
      zohoApiBaseUrlforPayment,
      JSON.stringify(req.body),
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${decryptToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status === 200 || response.status === 201) {
      const responseData = response.data;
      if (
        responseData &&
        responseData.data &&
        responseData.data[0].details.id
      ) {
        const userId = responseData.data[0].details.id;
        const getUserUrl = `${zohoApiBaseUrlforPayment}/${userId}`;
        const getUserResponse = await axios.get(getUserUrl, {
          headers: {
            Authorization: `Zoho-oauthtoken ${decryptToken}`,
            "Content-Type": "application/json",
          },
        });

        if (getUserResponse.status === 200) {
          res.status(getUserResponse.status).send(getUserResponse.data);
        } else {
          res
            .status(getUserResponse.status)
            .json({ message: "Failed to fetch user data" });
        }
      } else {
        res
          .status(response.status)
          .json({ message: "User added, but ID not found in response" });
      }
    } else {
      res
        .status(response.status)
        .json({ message: "Failed to create user in Zoho CRM" });
    }
  } catch (error) {
    if (
      error.response.status === 401 ||
      error.response.data.code === "INVALID_TOKEN"
    ) {
      const newAccessToken = await refreshAccessToken();

      var bytes = CryptoJS.AES.decrypt(newAccessToken, process.env.SECRET_KEY);
      var decryptToken = bytes.toString(CryptoJS.enc.Utf8);

      try {
        const responseData = await CommonFunForCatch(
          zohoApiBaseUrlforPayment,
          "post",
          `${decryptToken}`,
          JSON.stringify(req.body)
        );
        res.status(200).send(responseData);
      } catch (error) {
        res.status(500).json({
          message: "An error occurred while interacting with Zoho CRM",
        });
      }
    } else {
      res
        .status(500)
        .json({ message: "An error occurred while interacting with Zoho CRM" });
    }
  }
};

const zohoApiBaseUrlforOrder = "https://www.zohoapis.eu/crm/v5/Sales_Orders";

exports.Order = async (req, res) => {
  try {
    const accessToken = req.headers.authorization.split(" ");

    var bytes = CryptoJS.AES.decrypt(accessToken[1], process.env.SECRET_KEY);
    var decryptToken = bytes.toString(CryptoJS.enc.Utf8);

    const response = await axios.post(
      zohoApiBaseUrlforOrder,
      JSON.stringify(req.body),
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${decryptToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (response.status === 200 || response.status === 201) {
      const responseData = response.data;
      if (
        responseData &&
        responseData.data &&
        responseData.data[0].details.id
      ) {
        const userId = responseData.data[0].details.id;
        const getUserUrl = `${zohoApiBaseUrlforOrder}/${userId}`;
        const getUserResponse = await axios.get(getUserUrl, {
          headers: {
            Authorization: `Zoho-oauthtoken ${decryptToken}`,
            "Content-Type": "application/json",
          },
        });

        if (getUserResponse.status === 200) {
          res.status(getUserResponse.status).send(getUserResponse.data);
        } else {
          res
            .status(getUserResponse.status)
            .json({ message: "Failed to fetch user data" });
        }
      } else {
        res
          .status(response.status)
          .json({ message: "User added, but ID not found in response" });
      }
    } else {
      res
        .status(response.status)
        .json({ message: "Failed to create user in Zoho CRM" });
    }
  } catch (error) {
    if (
      error.response.status === 401 ||
      error.response.data.code === "INVALID_TOKEN"
    ) {
      const newAccessToken = await refreshAccessToken();

      var bytes = CryptoJS.AES.decrypt(newAccessToken, process.env.SECRET_KEY);
      var decryptToken = bytes.toString(CryptoJS.enc.Utf8);

      try {
        const responseData = await CommonFunForCatch(
          zohoApiBaseUrlforOrder,
          "post",
          `${decryptToken}`,
          JSON.stringify(req.body)
        );
        res.status(200).send(responseData);
      } catch (error) {
        res.status(500).json({
          message: "An error occurred while interacting with Zoho CRM",
        });
      }
    } else {
      res
        .status(500)
        .json({ message: "An error occurred while interacting with Zoho CRM" });
    }
  }
};

const zohoApiBaseUrlforInvoice = "https://www.zohoapis.eu/crm/v5/Invoices";

exports.Invoice = async (req, res) => {
  try {
    const accessToken = req.headers.authorization.split(" ");
    console.info("accessToken => ", accessToken);
    var bytes = CryptoJS.AES.decrypt(accessToken[1], process.env.SECRET_KEY);
    var decryptToken = bytes.toString(CryptoJS.enc.Utf8);

    const response = await axios.post(
      zohoApiBaseUrlforInvoice,
      JSON.stringify(req.body),
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${decryptToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (response.status === 200 || response.status === 201) {
      const responseData = response.data;

      if (
        responseData &&
        responseData.data &&
        responseData.data[0].details.id
      ) {
        const userId = responseData.data[0].details.id;
        const getUserUrl = `${zohoApiBaseUrlforInvoice}/${userId}`;
        const getUserResponse = await axios.get(getUserUrl, {
          headers: {
            Authorization: `Zoho-oauthtoken ${decryptToken}`,
            "Content-Type": "application/json",
          },
        });
        if (getUserResponse.status === 200 || getUserResponse.status === 201) {
          const userResponseData = getUserResponse.data;
          const invoiceData = userResponseData.data[0];
          const mailgun = new Mailgun(formData);
          const client = mailgun.client({
            username: "api",
            key: process.env.API_KEY,
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
              GrandTotal: invoiceData.Grand_Total,
            },
          });
          const browser = await puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
          });
          const page = await browser.newPage();
          await page.setContent(renderedHtml);
          const pdfBuffer = await page.pdf();
          await browser.close();

          const messageData = {
            from: "Co-Bloc <Co-Bloc@sandboxc10639357b204264abb15480215d1d14.mailgun.org>",
            to: invoiceData.Customer_Email,
            subject: `New Invoice from Co-Bloc #${invoiceData.Invoice_Number}`,
            html: `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>New Invoice Generated</title>
            </head>
            <body style="font-family: Arial, sans-serif;">
            
                <table style="width: 100%;">
                    <tr>
                        <td>
                            <p>Dear ${invoiceData?.First_Name?.name} ${invoiceData?.Last_Name},</p>
                            <br>
                            <p>This is to inform you that a new invoice has been generated.</p>
                            <p>The total amount due is €${invoiceData?.Invoiced_Items[0]?.Total}.</p>
                            <p>Thank you for choosing Co-Bloc.</p>
                            <br>
                            <p>Sincerely,</p>
                            <p>[Co Bloc]</p>
                        </td>
                    </tr>
                </table>
            
            </body>
            </html>`,
            attachment: [
              {
                data: pdfBuffer,
                filename: `${invoiceData.Invoice_Number}.pdf`,
              },
            ],
          };
          console.info("invoiceData => ", invoiceData);
          client.messages
            .create(process.env.DOMAIN, messageData)
            .then((response) => {
              console.info("Email sent successfully:", response);
              res.status(getUserResponse.status).send(getUserResponse.data);
            })
            .catch((err) => {
              console.info("Error sending email", err);
              res.status(getUserResponse.status).send(getUserResponse.data);
            });
        } else {
          res
            .status(getUserResponse.status)
            .json({ message: "Failed to fetch user data" });
        }
      } else {
        res
          .status(response.status)
          .json({ message: "User added, but ID not found in response" });
      }
    } else {
      res
        .status(response.status)
        .json({ message: "Failed to create user in Zoho CRM" });
    }
  } catch (error) {
    console.info("catch error ", error);
    if (
      error?.response?.status === 401 ||
      error?.response?.data?.code === "INVALID_TOKEN"
    ) {
      const newAccessToken = await refreshAccessToken();

      var bytes = CryptoJS.AES.decrypt(newAccessToken, process.env.SECRET_KEY);
      var decryptToken = bytes.toString(CryptoJS.enc.Utf8);

      try {
        const responseData = await CommonFunForCatch(
          zohoApiBaseUrlforInvoice,
          "post",
          `${decryptToken}`,
          JSON.stringify(req.body)
        );
        res.status(200).send(responseData);
      } catch (error) {
        res.status(500).json({
          message: "An error occurred while interacting with Zoho CRM",
        });
      }
    } else {
      res
        .status(500)
        .json({ message: "An error occurred while interacting with Zoho CRM" });
    }
  }
};

const zohoApiBaseUrlForSupport = "https://www.zohoapis.eu/crm/v5/Support";

exports.Support = async (req, res) => {
  try {
    const accessToken = req.headers.authorization.split(" ");

    var bytes = CryptoJS.AES.decrypt(accessToken[1], process.env.SECRET_KEY);
    var decryptToken = bytes.toString(CryptoJS.enc.Utf8);

    const response = await axios.post(
      zohoApiBaseUrlForSupport,
      JSON.stringify(req.body),
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${decryptToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status === 200 || response.status === 201) {
      res.status(response.status).send(response.data);
    } else {
      res
        .status(response.status)
        .json({ message: "Failed to create support in Zoho CRM" });
    }
  } catch (error) {
    console.log(error);
    if (
      error.response.status === 401 ||
      error.response.data.code === "INVALID_TOKEN"
    ) {
      const newAccessToken = await refreshAccessToken();

      var bytes = CryptoJS.AES.decrypt(newAccessToken, process.env.SECRET_KEY);
      var decryptToken = bytes.toString(CryptoJS.enc.Utf8);

      try {
        const responseData = await CommonFunForCatch(
          zohoApiBaseUrlForSupport,
          "post",
          `${decryptToken}`,
          JSON.stringify(req.body)
        );
        res.status(200).send(responseData);
      } catch (error) {
        res.status(500).json({
          message: "An error occurred while interacting with Zoho CRM",
        });
      }
    } else {
      res
        .status(500)
        .json({ message: "An error occurred while interacting with Zoho CRM" });
    }
  }
};

async function refreshAccessToken() {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const refreshTokenURL = "https://accounts.zoho.eu/oauth/v2/token";

  const data = {
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  };

  try {
    const response = await axios.post(refreshTokenURL, null, {
      params: data,
      headers: {
        "Content-Type": "application/json",
      },
    });
    const responseData = response.data;
    if (responseData.access_token) {
      const accessToken = responseData.access_token;
      let bcryptToken = CryptoJS.AES.encrypt(
        accessToken,
        process.env.SECRET_KEY
      ).toString();
      return bcryptToken;
    } else {
      console.error("Error refreshing access token. Response:", responseData);
      throw new Error("Error refreshing access token");
    }
  } catch (error) {
    console.error("Error refreshing access token:", error);
    throw new Error("Error refreshing access token");
  }
}

// this function is to truncate the additional decimal points
function truncateToDecimals(num, dec = 2) {
  const calcDec = Math.pow(10, dec);
  return Math.trunc(num * calcDec) / calcDec;
}
