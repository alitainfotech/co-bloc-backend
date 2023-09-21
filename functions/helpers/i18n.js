const { I18n } = require("i18n")
const i18n = new I18n()

i18n.configure({
    staticCatalog: {
        en: require("../translate/messages_en.json"),
        fr: require("../translate/messages_fr.json"),
    },
    defaultLocale: "en",
    retryInDefaultLocale: true,
    header: "txttlanguage",
    api: {
        __: "t",
    },
    register: global,
})

const t = (phrase, locale) => {
    var locale = locale ? locale : "en";
    return i18n.__({
        phrase: phrase,
        locale: locale,
    })
}

module.exports = { t, i18n }