const i18next = require("i18next")
const middleware = require("i18next-http-middleware")
const Backend = require("i18next-fs-backend");

i18next
    .use(Backend)
    .use(middleware.LanguageDetector)
    .init({
        backend: {
            loadPath: __dirname + "/../translate/locales/{{lng}}/{{ns}}.json",
        },
        fallbackLng: "en",
        preload: ["en", "fr", "es"],
        detection: {
            lookupHeader: "txttlanguage",
        },
    })

module.exports = { i18next, middleware }