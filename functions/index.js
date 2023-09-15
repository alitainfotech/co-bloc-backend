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
const {
  addUser,
  Pay,
  Payment,
  Order,
  Invoice,
  Support,
  RefreshAccessToken,
} = require("./Controller");

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(
  cors({
    origin: "*",
  })
);

app.post("/pay", async (req, res) => {
  await Pay(req, res);
});
app.post("/addUser", async (req, res) => {
  await addUser(req, res);
});
app.post("/Payment", async (req, res) => {
  await Payment(req, res);
});
app.post("/Order", async (req, res) => {
  await Order(req, res);
});
app.post("/Invoice", async (req, res) => {
  await Invoice(req, res);
});
app.post("/Support", async (req, res) => {
  await Support(req, res);
});
app.get("/Token", async (req, res) => {
  await RefreshAccessToken(req, res);
});

exports.app = functions.https.onRequest(app);
