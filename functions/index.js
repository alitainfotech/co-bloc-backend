const express = require('express')
const functions = require('firebase-functions');
const bodyParser = require('body-parser')
const cors = require('cors')
require("dotenv").config()
const path = require('path');
const { middleware, i18next } = require('./helpers/i18next');

const { addUser, Pay, Payment, Order, Invoice, Support, RefreshAccessToken, checkOrderId, checkEmail, ZohoWebhook, DownloadInvoice,  } = require('./Controller');
const { rateLimiterMiddleware } = require('./services/commonFuncions');

const app = express()
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))

app.use(
    cors({
      origin: [
        process.env.BASE_URL,
        process.env.TEST_BASE_URL,
        process.env.CO_BLOC_BASE_URL,
        process.env.CO_BLOC_BASE_URL1,
      ],
    })
  );

app.use(express.static(path.join(__dirname + '/public')));

app.use(middleware.handle(i18next))

app.use(rateLimiterMiddleware);

app.post('/pay', Pay);
app.post('/addUser', addUser);
app.post('/Payment', Payment);
app.post('/Order', Order);
app.post('/Invoice', Invoice);
app.post('/Support', Support);
app.get('/Token', RefreshAccessToken);
app.post('/CheckOrderId', checkOrderId);
app.post('/CheckEmail', checkEmail);
app.post('/ZohoWebhook', ZohoWebhook);
app.post('/InvoiceForThanksPage', DownloadInvoice);

exports.app = functions.https.onRequest(app)