var CryptoJS = require("crypto-js");
const nodemailer = require("nodemailer");
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

      // const mailgun = new Mailgun(formData);
      // const client = mailgun.client({
      //   username: process.env.MAILGUN_USERNAME,
      //   key: process.env.API_KEY,
      //   url: process.env.MAILGUN_URL,
      // });

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
            content: new Buffer(pdfBuffer, 'base64'),
            filename: `${invoiceData?.Invoice_Number}.pdf`,
            contentType: 'application/pdf'
          },
        ],
      };

      pdfResponseObj = {
        ...getInvoiceResponse.data,
        pdfBase64: pdfBase64,
        pdfFileName: pdfFileName,
      };
      await commonMailFunction(messageData)
      // client.messages
      //   .create(process.env.DOMAIN, messageData)
      //   .then((response) => {
      //     console.log("Email sent successfully:", response);
      //     //   return { getInvoiceResponse, pdfResponseObj };
      //   })
      //   .catch((err) => {
      //     console.log("Error sending email", err);
      //   });
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
  console.log("*******************dataSendWithMail********************");
  // const mailgun = new Mailgun(formData);
  // const client = mailgun.client({
  //   username: process.env.MAILGUN_USERNAME,
  //   key: process.env.API_KEY,
  //   url: process.env.MAILGUN_URL,
  // });

  const messageData = {
    from: `Co-Bloc <Co-Bloc@${process.env.DOMAIN}>`,
    to: "info@entertainment-lab.fr",
    subject: `Urgent: Manual Entry Required for Purchase Info in Zoho CRM`,
    html: `
    <tr>
    <td colspan="4" style="text-align: left; background-color: #fff">
        <span>
            <img src="https://us-central1-co-bloc-backend-91ed7.cloudfunctions.net/app/images/co-bloc-logo.jpg"
                alt="co-bloc logo">
        </span>
    </td>
    </tr><br><br>
    
        Dear Team,<br><br>

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
  await commonMailFunction(messageData);
  // client.messages
  //   .create(process.env.DOMAIN, messageData)
  //   .then((response) => {
  //     console.log("Email sent successfully:", response);
  //   })
  //   .catch((err) => {
  //     console.log("Error sending email", err);
  //   });
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
const commonMailFunction = async(mailInfo) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.forwardemail.net",
    port: 465,
    service: "gmail",
    secure: true,
    auth: {
      // TODO: replace `user` and `pass` values from <https://forwardemail.net>
      // user: process.env.NODEMAILER_USERID,
      // pass: process.env.NODEMAILER_PASSWORD,
      user: "test.alitainfotech@gmail.com",
      pass: "bwwrprvjtgnzgssl",
    },
  });
  console.log("mailInfo------------------", mailInfo.subject);
  // async..await is not allowed in global scope, must use a wrapper
  async function main() {
    // send mail with defined transport object
    const info = await transporter.sendMail({
      from: mailInfo.from, // sender address
      to: mailInfo.to, // list of receivers
      subject: mailInfo.subject, // Subject line
      text: mailInfo.text ? mailInfo.text : "", // plain text body
      html: mailInfo.html ? mailInfo.html : "", // html body
      attachments: mailInfo.attachment ? mailInfo.attachment : ""
    });
  
    console.log("Message sent***********************: %s", info.messageId);
  }
  try {
    await main()
  } catch (error) {
    console.log("****************send mail failed!**************", error)
  }
  // main().catch(console.error);
}

const optionData = [
  { CountryName: "Select country", CountryCode: "", dataKey: "SELECT_COUNTRY" },
  { CountryName: "Aland Islands", CountryCode: "AX", dataKey: "ALAND_ISLANDS" },
  { CountryName: "Albania", CountryCode: "AL", dataKey: "ALBANIA" },
  { CountryName: "Andorra", CountryCode: "AD", dataKey: "ANDORRA" },
  { CountryName: "Austria", CountryCode: "AT", dataKey: "AUSTRIA" },
  { CountryName: "Belarus", CountryCode: "BY", dataKey: "BELARUS" },
  { CountryName: "Belgium", CountryCode: "BE", dataKey: "BELGIUM" },
  {
    CountryName: "Bosnia and Herzegovina",
    CountryCode: "BA",
    dataKey: "BOSNIA_AND_HERZEGOVINA",
  },
  { CountryName: "Bulgaria", CountryCode: "BG", dataKey: "BULGARIA" },
  { CountryName: "Croatia", CountryCode: "HR", dataKey: "CROATIA" },
  { CountryName: "Czech Republic", CountryCode: "CZ", dataKey: "CZECH_REPUBLIC" },
  { CountryName: "Denmark", CountryCode: "DK", dataKey: "DENMARK" },
  { CountryName: "Estonia", CountryCode: "EE", dataKey: "ESTONIA" },
  { CountryName: "Faroe Islands", CountryCode: "FO", dataKey: "FRROE_ISLANDS" },
  { CountryName: "Finland", CountryCode: "FI", dataKey: "FINLAND" },
  { CountryName: "France", CountryCode: "FR", dataKey: "FRANCE" },
  { CountryName: "Germany", CountryCode: "DE", dataKey: "GERMANY" },
  { CountryName: "Gibraltar", CountryCode: "GI", dataKey: "GIBRALTAR" },
  { CountryName: "Greece", CountryCode: "GR", dataKey: "GREECE" },
  { CountryName: "Guernsey", CountryCode: "GG", dataKey: "GUERNSEY" },
  {
    CountryName: "Holy See (Vatican City State)",
    CountryCode: "VA",
    dataKey: "HOLY_SEE",
  },
  { CountryName: "Hungary", CountryCode: "HU", dataKey: "HUNGARY" },
  { CountryName: "Iceland", CountryCode: "IE", dataKey: "ICELAND" },
  { CountryName: "Ireland", CountryCode: "IR", dataKey: "IRELAND" },
  { CountryName: "Isle of Man", CountryCode: "IM", dataKey: "ISLE_OF_MAN" },
  { CountryName: "Italy", CountryCode: "IT", dataKey: "ITALY" },
  { CountryName: "Jersey", CountryCode: "JE", dataKey: "JERSEY" },
  { CountryName: "Kosovo", CountryCode: "XK", dataKey: "KOSOVO" },
  { CountryName: "Latvia", CountryCode: "LV", dataKey: "LATVIA" },
  { CountryName: "Liechtenstein", CountryCode: "LI", dataKey: "LIECHTENSTEIN" },
  { CountryName: "Lithuania", CountryCode: "LT", dataKey: "LITHUANIA" },
  { CountryName: "Luxembourg", CountryCode: "LU", dataKey: "LUXEMBOURG" },
  {
    CountryName: "Macedonia, the Former Yugoslav Republic of",
    CountryCode: "MK",
    dataKey: "MACEDONIA_THE_FORMER",
  },
  { CountryName: "Malta", CountryCode: "MT", dataKey: "MALTA" },
  { CountryName: "Moldova, Republic of", CountryCode: "MD", dataKey: "MOLDOVA_REPUBLIC" },
  { CountryName: "Monaco", CountryCode: "MC", dataKey: "MONACO" },
  { CountryName: "Montenegro", CountryCode: "ME", dataKey: "MONTENEGRO" },
  { CountryName: "Netherlands", CountryCode: "NL", dataKey: "NETHERLANDS" },
  { CountryName: "Norway", CountryCode: "NO", dataKey: "NORWAY" },
  { CountryName: "Poland", CountryCode: "PL", dataKey: "POLAND" },
  { CountryName: "Portugal", CountryCode: "PT", dataKey: "PORTUGAL" },
  { CountryName: "Romania", CountryCode: "RO", dataKey: "ROMANIA" },
  { CountryName: "San Marino", CountryCode: "SM", dataKey: "SAN_MARINO" },
  { CountryName: "Serbia", CountryCode: "RS", dataKey: "SERBIA" },
  {
    CountryName: "Serbia and Montenegro",
    CountryCode: "CS",
    dataKey: "SERBIA_AND_MONTENEGRO",
  },
  { CountryName: "Slovakia", CountryCode: "SK", dataKey: "SLOVAKIA" },
  { CountryName: "Spain", CountryCode: "ES", dataKey: "SPAIN" },
  { CountryName: "Svalbard and Jan Mayen", CountryCode: "SJ", dataKey: "SVALBARD_AND_JAN" },
  { CountryName: "Sweden", CountryCode: "SE", dataKey: "SWEDEN" },
  { CountryName: "Switzerland", CountryCode: "CH", dataKey: "SWITZERLAND" },
  { CountryName: "Ukraine", CountryCode: "UA", dataKey: "UKRAINE" },
  { CountryName: "United Kingdom", CountryCode: "UK", dataKey: "UNITED_KINGDOM" },
];

const findCountryName = (shippingCountryValue) => {
  const countryOption = optionData.find(option => option.CountryCode === shippingCountryValue);
  return countryOption ? countryOption.CountryName : null;
}

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
  commonMailFunction,
  findCountryName
};
