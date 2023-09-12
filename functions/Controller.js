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

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(
  cors({
    origin: "*",
  })
);

let globalAccessToken = null;

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
      globalAccessToken = accessToken;
      return globalAccessToken;
    } else {
      console.error("Error refreshing access token. Response:", responseData);
      throw new Error("Error refreshing access token");
    }
  } catch (error) {
    console.error("Error refreshing access token:", error);
    throw new Error("Error refreshing access token");
  }
}

async function CommonFunForCatch(url, method, accessToken, requestData = null) {
  const headers = {
    Authorization: accessToken,
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
    } else if (
      response.status === 401 &&
      response.data.code === "INVALID_TOKEN"
    ) {
      throw new Error("Invalid token");
    } else {
      throw new Error("Failed to create user in Zoho CRM");
    }
  } catch (error) {
    throw error;
  }
}

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.Pay = async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const convertedAmount = currency === "INR" ? amount * 100 : amount;
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
    const accessToken = req.headers.authorization;

    const response = await axios.post(
      zohoApiBaseUrl,
      JSON.stringify(req.body),
      {
        headers: {
          Authorization: accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("response.data======>>>", response.data);
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
            Authorization: accessToken,
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
        console.log(getUserResponse.data);
      } else {
        res
          .status(response.status)
          .json({ message: "User added, but ID not found in response" });
      }
    } else if (
      response.status === 401 &&
      response.data.code === "INVALID_TOKEN"
    ) {
      throw response;
    } else {
      res
        .status(response.status)
        .json({ message: "Failed to create user in Zoho CRM" });
    }
  } catch (error) {
    if (
      error.response.status === 401 &&
      error.response.data.code === "INVALID_TOKEN"
    ) {
      const newAccessToken = await refreshAccessToken();
      try {
        const responseData = await CommonFunForCatch(
          zohoApiBaseUrl,
          "post",
          `Zoho-oauthtoken ${globalAccessToken}`,
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
    const accessToken = req.headers.authorization;

    const response = await axios.post(
      zohoApiBaseUrlforPayment,
      JSON.stringify(req.body),
      {
        headers: {
          Authorization: accessToken,
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
            Authorization: accessToken,
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
      error.response &&
      error.response.status === 401 &&
      error.response.data.code === "INVALID_TOKEN"
    ) {
      const newAccessToken = await refreshAccessToken();
      try {
        const responseData = await CommonFunForCatch(
          zohoApiBaseUrlforPayment,
          "post",
          `Zoho-oauthtoken ${globalAccessToken}`,
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
    const accessToken = req.headers.authorization;

    const response = await axios.post(
      zohoApiBaseUrlforOrder,
      JSON.stringify(req.body),
      {
        headers: {
          Authorization: accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(response.data);
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
            Authorization: accessToken,
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
      error.response.status === 401 &&
      error.response.data.code === "INVALID_TOKEN"
    ) {
      const newAccessToken = await refreshAccessToken();
      try {
        const responseData = await CommonFunForCatch(
          zohoApiBaseUrlforOrder,
          "post",
          `Zoho-oauthtoken ${globalAccessToken}`,
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
    const accessToken = req.headers.authorization;
    const response = await axios.post(
      zohoApiBaseUrlforInvoice,
      JSON.stringify(req.body),
      {
        headers: {
          Authorization: accessToken,
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
            Authorization: accessToken,
            "Content-Type": "application/json",
          },
        });
        if (getUserResponse.status === 200) {
          const userResponseData = getUserResponse.data;
          const invoiceData = userResponseData.data[0];

          const mailgun = new Mailgun(formData);
          const client = mailgun.client({
            username: "api",
            key: process.env.API_KEY,
          });

          const ejsTemplatePath = path.join(__dirname, "./invoice.ejs");
          const templateContent = fs.readFileSync(ejsTemplatePath, "utf8");
          const renderedHtml = ejs.render(templateContent, {
            Invoices: {
              CustomerName: invoiceData.First_Name.name,
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
              ListPrice: invoiceData.Invoiced_Items[0].List_Price,
              Amount: invoiceData.Invoiced_Items[0].Total,
              SubTotal: invoiceData.Sub_Total,
              GrandTotal: invoiceData.Grand_Total,
            },
          });
          const browser = await puppeteer.launch();
          const page = await browser.newPage();
          await page.setContent(renderedHtml);
          const pdfBuffer = await page.pdf();
          await browser.close();

          const messageData = {
            from: "Excited User <yaman@sandbox9c68f09718d943bf94c0d68423461948.mailgun.org>",
            to: invoiceData.Customer_Email,
            subject: "Invoice PDF",
            text: "Please find the PDF attachment.",
            attachment: [
              {
                data: pdfBuffer,
                filename: `${invoiceData.Invoice_Number}.pdf`,
              },
            ],
          };

          client.messages
            .create(process.env.DOMAIN, messageData)
            .then((response) => {
              console.log("Email sent successfully:", response);
              res.status(200).send("Email sent successfully");
            })
            .catch((err) => {
              res.status(500).send("Error sending email");
            });

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
      error.response.status === 401 &&
      error.response.data.code === "INVALID_TOKEN"
    ) {
      const newAccessToken = await refreshAccessToken();
      try {
        const responseData = await CommonFunForCatch(
          zohoApiBaseUrlforInvoice,
          "post",
          `Zoho-oauthtoken ${globalAccessToken}`,
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
    const accessToken = req.headers.authorization;

    const response = await axios.post(
      zohoApiBaseUrlForSupport,
      JSON.stringify(req.body),
      {
        headers: {
          Authorization: accessToken,
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
    if (
      error.response.status === 401 &&
      error.response.data.code === "INVALID_TOKEN"
    ) {
      const newAccessToken = await refreshAccessToken();
      try {
        const responseData = await CommonFunForCatch(
          zohoApiBaseUrlForSupport,
          "post",
          `Zoho-oauthtoken ${globalAccessToken}`,
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
