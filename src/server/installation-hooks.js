"use strict";

const _ = require("lodash");
const request = require("request");
const Express = require("express");

const jwt = require("jsonwebtoken");
const auth0 = process.env["NON_WEBTASK_RUNTIME"] === "1" ? require("auth0") : require("auth0@2.1.0");

module.exports = function (files) {
    var hooks = Express.Router();

    hooks.use(function (req, res, next) {
        if (!req.headers.authorization) {
            return res.sendStatus(401);
        }

        var parts = req.headers.authorization.split(' ');

        if (parts[0] !== 'Bearer') {
            return res.sendStatus(401);
        }

        var token = parts[1];

        try {
            jwt.verify(token, req.webtaskContext.data.EXTENSION_SECRET, {
                algorithms: ["HS256"],
                audience: req.absoluteUrl,
                issuer: 'https://' + req.webtaskContext.data.AUTH0_DOMAIN
            });
        } catch (error) {
            console.log(error);
            return res.sendStatus(401);
        }

        return next();
    });

    hooks.use(function (req, res, next) {
        getToken(req, function (access_token, err) {
            if (err) {
                console.log("Failed to obtain access token: " + error);

                return next(err);
            }

            var management = new auth0.ManagementClient({
                domain: req.webtaskContext.data.AUTH0_DOMAIN,
                token: access_token
            });

            req.auth0 = management;

            next();
        });
    });

    const RULE_NAME = "Multi-Factor-VoiceIt-Do-Not-Rename";

    hooks.post('/on-install', function (req, res) {
        var sourcecode = files["mfa-redirect-rule.js"];

        var webtaskUrl = req.absoluteBaseUrl;
        var auth0WebtaskUrl = req.webtaskContext.data.WT_URL;

        if (auth0WebtaskUrl) {
            var URL_REGEX = /https:\/\/sandbox(?:-?)(eu|au)?.*\.it\.auth0\.com\/api\/run\/(.*?)\/(.*?)\/*$/;
            var result = URL_REGEX.exec(auth0WebtaskUrl);

            if (result) {
                var region = result[1] ? result[1] : "us";

                webtaskUrl = `https://${result[2]}.${region}.webtask.io/${result[3]}/`;
            }
        }

        var canUsePhoneAuthentication = true;
        canUsePhoneAuthentication = canUsePhoneAuthentication && !!req.webtaskContext.data.TWILIO_ACCOUNT_SID;
        canUsePhoneAuthentication = canUsePhoneAuthentication && !!req.webtaskContext.data.TWILIO_AUTH_TOKEN;
        canUsePhoneAuthentication = canUsePhoneAuthentication && !!req.webtaskContext.data.TWILIO_PHONE_NUMBER;

        var placeholders = {
            "${SIGNING_KEY_PLACEHOLDER}": req.config.signingKey,
            "${ENCRYPTION_KEY_PLACEHOLDER}": req.webtaskContext.data.ENCRYPTION_KEY,
            "${APP_URL_PLACEHOLDER}": webtaskUrl,
            "${CAN_USE_PHONE_AUTH_PLACEHOLDER}": canUsePhoneAuthentication
        };

        _.forEach(placeholders, function (value, key) {
            sourcecode = sourcecode.replace(key, value);
        });

        req.auth0.rules.getAll().then(function (rules) {
            var rule = _.find(rules, { name: RULE_NAME });

            if (rule) {
                req.auth0.rules.delete({ id: rule.id }).then(function () {
                    req.auth0.rules.create({
                        name: RULE_NAME,
                        script: sourcecode,
                        enabled: true
                    }).then(function () {
                        res.sendStatus(204);
                    }).catch(function (error) {
                        console.log(error);
                        res.sendStatus(500);
                    });
                }).catch(function () {
                    res.sendStatus(500);
                });
            } else {
                req.auth0.rules.create({
                    name: RULE_NAME,
                    script: sourcecode,
                    enabled: true
                }).then(function () {
                    res.sendStatus(204);
                }).catch(function (error) {
                    console.log(error);
                    res.sendStatus(500);
                });
            }
        }).catch(function (error) {
            console.log(error);
            res.sendStatus(500);
        });
    });

    hooks.put('/on-update', function (req, res) {
        res.sendStatus(204);
    });

    hooks.delete('/on-uninstall', function (req, res) {
        req.auth0.rules.getAll().then(function (rules) {
            var rule = _.find(rules, { name: RULE_NAME });

            if (rule) {
                req.auth0.rules.delete({ id: rule.id }).then(function () {
                    res.sendStatus(204);
                }).catch(function (error) {
                    console.log("Failed to delete rule: " + error);
                    res.sendStatus(500);
                });
            } else {
                res.sendStatus(204);
            }
        }).catch(function (error) {
            console.log("Failed to list rules: " + error);
            res.sendStatus(500);
        });
    });

    return hooks;
};

function getToken(req, cb) {
    var tokenEndpointUrl = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/oauth/token';
    var audience = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/api/v2/';
    var clientId = req.webtaskContext.data.AUTH0_CLIENT_ID;
    var clientSecret = req.webtaskContext.data.AUTH0_CLIENT_SECRET;

    request({
        uri: tokenEndpointUrl,
        json: {
            audience: audience,
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret
        },
        method: 'POST'
    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            cb(body.access_token);
        } else {
            cb(null, error);
        }
    });
}