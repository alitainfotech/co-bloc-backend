var CryptoJS = require("crypto-js");
const axios = require("axios");
const { REFRESH_TOKEN } = require("../commonConstant");
require("dotenv").config()


// this function is to truncate the additional decimal points
const truncateToDecimals = (num, dec = 2) => {
    const calcDec = Math.pow(10, dec);
    return Math.trunc(num * calcDec) / calcDec;
}


// for Decrypt token to Access token
const decryptAccessToken = (data, secretKey) => {
    try {
        let accessToken = (data && data.headers) ?  data.headers.authorization.split(" ")[1] : data;
        let bytes = CryptoJS.AES.decrypt(accessToken, secretKey);
        let decryptToken = bytes.toString(CryptoJS.enc.Utf8);
        return decryptToken;
    } catch (error) {
        throw new Error('Failed to decrypt access token');
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
            res.status(500).json({ error: req.t("ACCESS_TOKEN_ERROR") })
        }
    } catch (error) {
        console.error('Error refreshing access token:', error);
        res.status(500).json({ error: req.t("ACCESS_TOKEN_ERROR") })
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

module.exports = {
    decryptAccessToken,
    getZohoHeaders,
    refreshAccessToken,
    commonFunForCatch,
    sanitizeHtml,
    truncateToDecimals
}