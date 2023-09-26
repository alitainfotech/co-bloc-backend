const express = require('express')
const functions = require('firebase-functions');
const bodyParser = require('body-parser')
const cors = require('cors')
require("dotenv").config()
const { middleware, i18next } = require('./helpers/i18next');

const { addUser, Pay, Payment, Order, Invoice, Support, RefreshAccessToken } = require('./Controller');

const app = express()
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(
    cors({origin: process.env.BASE_URL})
);
app.use(middleware.handle(i18next))

app.post('/pay', Pay);
app.post('/addUser', addUser);
app.post('/Payment', Payment);
app.post('/Order', Order);
app.post('/Invoice', Invoice);
app.post('/Support', Support);
app.get('/Token', RefreshAccessToken);

exports.app = functions.https.onRequest(app)