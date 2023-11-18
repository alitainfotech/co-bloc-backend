var CryptoJS = require("crypto-js");
const axios = require("axios");
const { REFRESH_TOKEN } = require("../commonConstant");
const Mailgun = require("mailgun.js");
const formData = require("form-data");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const path = require("path");
const fs = require("fs");
const ejs = require("ejs");
const puppeteer = require("puppeteer");
require("dotenv").config();

// this function is to truncate the additional decimal points
const truncateToDecimals = (num, dec = 2) => {
  const calcDec = Math.pow(10, dec);
  return Math.trunc(num * calcDec) / calcDec;
};

// for Decrypt token to Access token
const decryptAccessToken = async (data, secretKey) => {
  try {
    let accessToken =
      data && data.headers ? data.headers.authorization.split(" ")[1] : data;

    if (!accessToken) {
      console.error("Access token is empty or undefined.");
      return null;
    }

    let bytes = CryptoJS.AES.decrypt(accessToken, secretKey);

    if (!bytes || !bytes.toString) {
      console.error("Decryption failed or resulted in an invalid value.");
      return null;
    }

    let decryptToken = bytes.toString(CryptoJS.enc.Utf8);

    return decryptToken;
  } catch (error) {
    console.error("An error occurred:", error);
    return null;
  }
};

// for headers
const getZohoHeaders = (decryptToken) => {
  return {
    Authorization: `Zoho-oauthtoken ${decryptToken}`,
    "Content-Type": "application/json",
  };
};

// for generate a access token
const refreshAccessToken = async () => {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const refreshTokenURL = `${process.env.REFRESH_TOKEN_URL}/token`;

  const data = {
    grant_type: REFRESH_TOKEN,
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
};

// for Common functions for catch
const commonFunForCatch = async (
  url,
  method,
  decryptToken,
  requestData = null
) => {
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
          res.status(500).json({ error: req.t("USER_FETCH_DATA_FAILED") });
        }
      } else {
        res.status(500).json({ error: req.t("FAILED_CREATE_USER") });
      }
    }
  } catch (error) {
    throw error;
  }
};

const invoicePDF = async (response, decryptToken) => {
  const zohoApiBaseUrlforInvoice = `${process.env.ZOHO_CRM_V5_URL}/Invoices`;
  let pdfResponseObj = {};
  const responseData = response.data;
  if (responseData && responseData.data && responseData.data[0].details.id) {
    const userId = responseData.data[0].details.id;
    const getInvoice = `${zohoApiBaseUrlforInvoice}/${userId}`;
    const getInvoiceResponse = await axios.get(getInvoice, {
      headers: getZohoHeaders(decryptToken),
    });
    if (
      getInvoiceResponse.status === 200 ||
      getInvoiceResponse.status === 201
    ) {
      const invoiceData = getInvoiceResponse.data.data[0];

      const mailgun = new Mailgun(formData);
      const client = mailgun.client({
        username: process.env.MAILGUN_USERNAME,
        key: process.env.API_KEY,
        url: process.env.MAILGUN_URL,
      });

      const pdfBuffer = await generateInvoicePDF(invoiceData);

      const pdfFileName = `${invoiceData?.Invoice_Number}.pdf`;

      const pdfBase64 = pdfBuffer.toString("base64");

      const htmlTemplatePath = path.join(__dirname, "../pdfIndextext.ejs");
      const htmltemplateContent = fs.readFileSync(htmlTemplatePath, "utf8");
      const html = ejs.render(htmltemplateContent, {
        Invoices: {
          CustomerName: invoiceData.First_Name.name,
          LastName: invoiceData.Last_Name,
          Amount: invoiceData.Invoiced_Items[0].Total,
        },
      });

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

      pdfResponseObj = {
        ...getInvoiceResponse.data,
        pdfBase64: pdfBase64,
        pdfFileName: pdfFileName,
      };

      client.messages
        .create(process.env.DOMAIN, messageData)
        .then((response) => {
          console.log("Email sent successfully:", response);
          //   return { getInvoiceResponse, pdfResponseObj };
        })
        .catch((err) => {
          console.log("Error sending email", err);
        });
      return { getInvoiceResponse, pdfResponseObj };
    } else {
      return { getInvoiceResponse, message: req.t("FAILED_INVOICE") };
    }
  }
};

// Cross-Site Scripting solutions

const sanitizeHtml = (html) => {
  var tagBody = "(?:[^\"'>]|\"[^\"]*\"|'[^']*')*";

  var tagOrComment = new RegExp(
    "<(?:" + "!--(?:(?:-*[^->])*--+|-?)" + "|/?[a-z]" + tagBody + ")>",
    "gi"
  );

  var oldHtml;

  do {
    oldHtml = html;
    html = html.replace(tagOrComment, "");
    html = html.replace(/alert\('(.+?)'\)/g, "$1");
  } while (html !== oldHtml);
  return html.replace(/</g, "&lt;");
};

const dataSendWithMail = async (FormData) => {
  const mailgun = new Mailgun(formData);
  const client = mailgun.client({
    username: process.env.MAILGUN_USERNAME,
    key: process.env.API_KEY,
    url: process.env.MAILGUN_URL,
  });

  const messageData = {
    from: `Co-Bloc <Co-Bloc@${process.env.DOMAIN}>`,
    to: "info@entertainment-lab.fr",
    subject: `Urgent: Manual Entry Required for Purchase Info in Zoho CRM`,
    html: `Dear Team,<br><br>

        I wanted to bring to your attention a technical issue that has recently come to our notice regarding the addition of user details in Zoho CRM.
        
        It has been observed that some users have encountered difficulties while attempting to add user details to Zoho CRM due to a technical glitch. Regrettably, this issue has resulted in the failure to store these crucial details in our CRM system automatically.
        
        In order to ensure that no important user information is lost, we kindly request your immediate assistance. We need to manually input the affected user details into Zoho CRM to maintain the integrity of our records and to ensure that our processes continue to run smoothly.
        
        To facilitate this process, please follow these steps:
        
        <h1><strong>Customer Information:</strong></h1>
    <ul>
        <li><strong>Name:</strong> ${FormData?.Name}</li>
        <li><strong>Last Name:</strong> ${FormData?.Last_Name}</li>
        <li><strong>Email:</strong> ${FormData?.Email}</li>
        <li><strong>Phone Number:</strong> ${FormData?.Phone_Number}</li>
        <li><strong>Address Line:</strong> ${FormData?.Address_Line}</li>
        <li><strong>Country:</strong> ${FormData?.Country}</li>
        <li><strong>Zip Code:</strong> ${FormData?.Zip_Code}</li>
        <li><strong>City:</strong> ${FormData?.City}</li>
    </ul> 

        <h1><strong>Order Information:</strong></h1>
    <ul>
        <li><strong>First Name:</strong> ${FormData?.Shipping_First_Name}</li>
        <li><strong>Last Name:</strong> ${FormData?.Shipping_Last_Name}</li>
        <li><strong>Quantity:</strong> ${FormData?.Ordered_Items[0]?.Quantity}</li>
        <li><strong>Payment Currency:</strong> ${FormData?.Payment_Currency}</li>
        <li><strong>Billing Country:</strong> ${FormData?.Billing_Country}</li>
        <li><strong>Billing City:</strong> ${FormData?.Billing_City}</li>
        <li><strong>Billing Street:</strong> ${FormData?.Billing_Street}</li>
        <li><strong>Billing Code:</strong> ${FormData?.Billing_Code}</li>
        <li><strong>Shipping Country:</strong> ${FormData?.Shipping_Country}</li>
        <li><strong>Shipping City:</strong> ${FormData?.Shipping_City}</li>
        <li><strong>Shipping Street:</strong> ${FormData?.Shipping_Street}</li>
        <li><strong>Shipping Code:</strong> ${FormData?.Shipping_Code}</li>
    </ul>

        <h1><strong>Payment Information:</strong></h1>
    <ul>
        <li><strong>Payment Id:</strong> ${FormData?.payment_id}</li>
        <li><strong>Order ID:</strong> ${FormData?.Order_Id}</li>
        <li><strong>Amount:</strong> ${FormData?.Amount}</li>
        <li><strong>Payment Currency:</strong> ${FormData?.Payment_Currency}</li>
        <li><strong>Payment Status:</strong> ${FormData?.Payment_Status}</li>
    </ul>    

        <h1><strong>Invoice Information:</strong></h1>
    <ul>
        <li><strong>Customer Name:</strong> ${FormData?.Name}</li>
        <li><strong>Invoice Date:</strong> ${FormData?.Invoice_Date}</li>
        <li><strong>Billing Country:</strong> ${FormData?.Billing_Country} </li>
        <li><strong>Billing City:</strong> ${FormData?.Billing_City}</li>
        <li><strong>Billing Street:</strong> ${FormData?.Billing_Street}</li>
        <li><strong>Billing Code:</strong> ${FormData?.Billing_Code}</li>
        <li><strong>Shipping Country:</strong> ${FormData?.Shipping_Country} </li>
        <li><strong>Shipping City:</strong> ${FormData?.Shipping_City}</li>
        <li><strong>Shipping Street:</strong> ${FormData?.Shipping_Street}</li>
        <li><strong>Shipping Code:</strong> ${FormData?.Shipping_Code}</li>
        <li><strong>Quantity:</strong> ${FormData?.Invoiced_Items[0]?.Quantity}</li>
        <li><strong>Subject:</strong> ${FormData?.Subject}</li>
        <li><strong>Account Name:</strong> ${FormData?.Account_Name}</li>
    </ul>    

        Thank you for your dedication and swift action in resolving this issue.Your efforts are essential in keeping our operations running smoothly.<br><br><br>
        
        
        Best regards,<br><br>
        
        Co-Bloc support`,
  };

  client.messages
    .create(process.env.DOMAIN, messageData)
    .then((response) => {
      console.log("Email sent successfully:", response);
    })
    .catch((err) => {
      console.log("Error sending email", err);
    });
};

// Create a rate limiter middleware function

const limiter = new RateLimiterMemory({
  points: 100,
  duration: 1,
});

const rateLimiterMiddleware = (req, res, next) => {
  limiter
    .consume(req.ip)
    .then(() => {
      next();
    })
    .catch(() => {
      return res.status(429).json({ message: "Too Many Requests" });
    });
};

// Generate Invoice PDF

const generateInvoicePDF = async (invoiceData) => {
  const ejsTemplatePath = path.join(__dirname, "../pdfIndex.ejs");
  const templateContent = fs.readFileSync(ejsTemplatePath, "utf8");
  const renderedHtml = ejs.render(templateContent, {
    Invoices: {
      CustomerName: invoiceData.First_Name.name,
      LastName: invoiceData.Last_Name,
      ShippingFirstName: invoiceData.Shipping_First_Name1,
      ShippingLastName: invoiceData.Shipping_Last_Name,
      InvoiceDate: invoiceData.Invoice_Date,
      InvoiceNumber: invoiceData.Invoice_Number,
      BillingStreet: invoiceData.Billing_Street,
      BillingCity: invoiceData.Billing_City,
      BillingProvince: invoiceData.Billing_State,
      BillingCountry: invoiceData.Billing_Country,
      BillingCode: invoiceData.Billing_Code,
      ShippingStreet: invoiceData.Shipping_Street,
      ShippingCity: invoiceData.Shipping_City,
      ShippingCountry: invoiceData.Shipping_Country,
      ShippingCode: invoiceData.Shipping_Code,
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

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setContent(renderedHtml);
  const pdfBuffer = await page.pdf();
  await browser.close();

  return pdfBuffer;
};

const sendEmail = (client, messageData, successMessage) => {
  client.messages
    .create(process.env.DOMAIN, messageData)
    .then((response) => {
      console.log(successMessage, response);
    })
    .catch((err) => {
      console.log("Error sending email", err);
    });
};

module.exports = {
  decryptAccessToken,
  getZohoHeaders,
  refreshAccessToken,
  commonFunForCatch,
  sanitizeHtml,
  truncateToDecimals,
  dataSendWithMail,
  rateLimiterMiddleware,
  generateInvoicePDF,
  sendEmail,
  invoicePDF,
};
