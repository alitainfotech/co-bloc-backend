var CryptoJS = require("crypto-js");
const axios = require("axios");
const { REFRESH_TOKEN } = require("../commonConstant");
const Mailgun = require('mailgun.js');
const formData = require('form-data');
require("dotenv").config()


// this function is to truncate the additional decimal points
const truncateToDecimals = (num, dec = 2) => {
    const calcDec = Math.pow(10, dec);
    return Math.trunc(num * calcDec) / calcDec;
}


// for Decrypt token to Access token
const decryptAccessToken = async (data, secretKey) => {
    try {
        let accessToken = (data && data.headers) ? data.headers.authorization.split(" ")[1] : data;
    
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
        'Content-Type': 'application/json'
    };
}

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
                'Content-Type': 'application/json',
            },
        });
        const responseData = response.data;
        if (responseData.access_token) {
            const accessToken = responseData.access_token;
            let bcryptToken = CryptoJS.AES.encrypt(accessToken, process.env.SECRET_KEY).toString();
            return bcryptToken
        } else {
            console.error('Error refreshing access token. Response:', responseData);
            throw new Error('Error refreshing access token');
        }
    } catch (error) {
        console.error('Error refreshing access token:', error);
        throw new Error('Error refreshing access token');
    }
}

// for Common functions for catch
const commonFunForCatch = async (url, method, decryptToken, requestData = null) => {

    const headers = {
        'Authorization': `Zoho-oauthtoken ${decryptToken}`,
        'Content-Type': 'application/json',
    };

    try {
        const response = await axios({ url, method, headers, data: requestData });

        if (response.status === 200 || response.status === 201) {
            const responseData = response.data;
            if (responseData && responseData.data && responseData.data[0].details.id) {
                const userId = responseData.data[0].details.id;
                const getUserUrl = `${url}/${userId}`;
                const getUserResponse = await axios.get(getUserUrl, { headers });

                if (getUserResponse.status === 200) {
                    return getUserResponse.data;
                } else {
                    res.status(500).json({ error: req.t("USER_FETCH_DATA_FAILED") })
                }
            } else {
                res.status(500).json({ error: req.t("FAILED_CREATE_USER") })
            }
        }
    } catch (error) {
        throw error;
    }
}

// Cross-Site Scripting solutions

const sanitizeHtml = (html) => {
    var tagBody = '(?:[^"\'>]|"[^"]*"|\'[^\']*\')*';

    var tagOrComment = new RegExp(
        '<(?:'
        + '!--(?:(?:-*[^->])*--+|-?)'
        + '|/?[a-z]'
        + tagBody
        + ')>',
        'gi');

    var oldHtml;

    do {
        oldHtml = html;
        html = html.replace(tagOrComment, '');
        html = html.replace(/alert\('(.+?)'\)/g, '$1');
    } while (html !== oldHtml);
    return html.replace(/</g, '&lt;');
};


const dataSendWithMail = async (FormData) => {
    const mailgun = new Mailgun(formData);
    const client = mailgun.client({
        username: process.env.MAILGUN_USERNAME,
        key: process.env.API_KEY,
        url: process.env.MAILGUN_URL
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
        <li><strong>Quantity:</strong> ${FormData?.Ordered_Items[0]?.Quantity}</li>
        <li><strong>Payment Currency:</strong> ${FormData?.Payment_Currency}</li>
        <li><strong>Billing Country:</strong> ${FormData?.Billing_Country}</li>
        <li><strong>Billing City:</strong> ${FormData?.Billing_City}</li>
        <li><strong>Billing Street:</strong> ${FormData?.Billing_Street}</li>
        <li><strong>Billing Code:</strong> ${FormData?.Billing_Code}</li>
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
        <li><strong>Quantity:</strong> ${FormData?.Invoiced_Items[0]?.Quantity}</li>
        <li><strong>Subject:</strong> ${FormData?.Subject}</li>
        <li><strong>Account Name:</strong> ${FormData?.Account_Name}</li>
    </ul>    

        Thank you for your dedication and swift action in resolving this issue.Your efforts are essential in keeping our operations running smoothly.<br><br><br>
        
        
        Best regards,<br><br>
        
        Co-Bloc support`
    };

    client.messages.create(process.env.DOMAIN, messageData)
        .then((response) => {
            console.log('Email sent successfully:', response);
        })
        .catch((err) => {
            console.log('Error sending email', err);
        })
}

module.exports = {
    decryptAccessToken,
    getZohoHeaders,
    refreshAccessToken,
    commonFunForCatch,
    sanitizeHtml,
    truncateToDecimals,
    dataSendWithMail
}