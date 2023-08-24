import fs from 'fs';
import express from 'express'
import { Filter, MongoClient, ObjectId } from "mongodb";
import { ACCESSSECRET, ACCESS_KEY, ACCESS_TOKEN_EXP_NUMBER, BUCKET_NAME, CONEKTA_API_KEY, MONGO_DB, PORT, REFRESHSECRET, REFRESH_TOKEN_EXP_NUMBER, SECRET_KEY } from "./config";
import bcrypt from "bcryptjs"
import jsonwebtoken, { SignOptions } from "jsonwebtoken"
import cookieParser from "cookie-parser"
import { CustomersApi, Configuration, OrdersApi } from 'conekta';
import { Request } from 'express';
import { AxiosError } from "axios"
import cors from "cors"
import cron from 'node-cron';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { CartsByUserMongo, ContextLocals, DecodeJWT, InventoryMongo, ItemsByCartMongo, PurchasesMongo, ReservedInventoryMongo, SessionCookie, SessionMongo, UserJWT } from './types';
import { generateProductHTML } from './utils';

const clientS3 = new S3Client({
    apiVersion: "2006-03-01",
    region: process.env.REGION,
    credentials: {
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
    },
});

const config = new Configuration({ accessToken: CONEKTA_API_KEY });
const customerClient = new CustomersApi(config);
const orderClient = new OrdersApi(config);

class Context {
    static _bindings = new WeakMap<Request, Context>();

    public userJWT: DecodeJWT | null = null;
    public sessionCookie: SessionCookie | null = null;

    static bind(req: Request): void {
        const ctx = new Context();
        Context._bindings.set(req, ctx);
    }

    static get(req: Request): Context | null {
        return Context._bindings.get(req) || null;
    }
}



export const jwt = {
    decode: (token: string): string | DecodeJWT | null => {
        const decoded = jsonwebtoken.decode(token);
        return decoded as string | DecodeJWT | null;
    },
    verify: (token: string, password: string): DecodeJWT | null => {
        try {
            const payload = jsonwebtoken.verify(token, password);
            if (typeof payload === "string") {
                throw new Error("payload is not string")
            }
            return payload as DecodeJWT;
        } catch {
            return null
        }
    },
    sign: (
        data: {
            user: UserJWT;
            refreshTokenExpireTime: number;
            exp: number;
        },
        secret: string,
        options?: SignOptions
    ): string => {
        const token = jsonwebtoken.sign(data, secret, options);
        return token;
    },
};

const app = express()

app.use(cors({
    origin: ["https://fourb.localhost", "https://fourb.mx"]
}))

app.use(express.json())
app.use(cookieParser())

app.use((req, res, next) => {
    Context.bind(req);
    next()
})

app.use((req, res, next) => {
    const ctx = Context.get(req);
    const refreshToken = req.cookies.refreshToken
    if (!refreshToken) {
        return next()
    }
    const authorization = req.headers.authorization
    if (authorization) {
        const payload = jwt.verify(authorization, ACCESSSECRET)
        if (payload && typeof payload !== "string") {
            if (ctx) {
                ctx.userJWT = payload
                res.setHeader("accessToken", authorization)
            }
        }
    }
    if (!ctx?.userJWT?.user) {
        const payload = jwt.verify(refreshToken, REFRESHSECRET);
        if (payload) {
            const now = new Date();
            now.setMilliseconds(0);
            const accessTokenExpireTime = now.getTime() / 1000 + ACCESS_TOKEN_EXP_NUMBER;
            const newAccessToken = jwt.sign(
                {
                    user: {
                        _id: payload.user._id,
                        cart_id: payload.user.cart_id,
                        is_admin: payload.user.is_admin,
                    },
                    refreshTokenExpireTime: payload.exp,
                    exp: accessTokenExpireTime > payload.exp ? payload.exp : accessTokenExpireTime,
                },
                ACCESSSECRET
            );
            res.setHeader("accessToken", newAccessToken)
            if (ctx) {
                ctx.userJWT = payload
            }
        }
    }
    next()
})

app.use(async (req, res, next) => {
    const ctx = Context.get(req);
    const locals = req.app.locals as ContextLocals
    const { sessions, cartsByUser } = locals
    if (!req.cookies.session) {
        const session_id = new ObjectId()
        const cart_id = new ObjectId()
        const session: SessionMongo = {
            _id: session_id,
            name: null,
            apellidos: null,
            email: null,
            cart_id,
            phone: null,
            conekta_id: null,
            country: null,
            street: null,
            colonia: null,
            zip: null,
            city: null,
            state: null,
            phone_prefix: null,
        }
        res.cookie("session", JSON.stringify(session), {
            secure: true,
        })
        await Promise.all([
            sessions.insertOne(session),
            cartsByUser.insertOne({
                _id: cart_id,
                user_id: session_id,
                expireDate: null
            })
        ])
        if (ctx) {
            ctx.sessionCookie = {
                _id: session_id.toHexString(),
                name: null,
                apellidos: null,
                email: null,
                cart_id: cart_id.toHexString(),
                addresses: [],
                phone: null,
                conekta_id: null,
                default_address: null,
                phone_prefix: null,
            }
        }
    } else {
        const session = JSON.parse(req.cookies.session)
        if (session) {
            if (ctx) {
                ctx.sessionCookie = JSON.parse(req.cookies.session)
            }
        }
    }
    next()
})

app.get('/inventory', async (req, res) => {
    const search = req.query.search
    const tag = req.query.tag
    const limit = Number(req.query.limit)
    const after = req.query.after
    const discounts = req.query.discounts
    const limitParsed = limit ? limit : 20
    const { inventory } = req.app.locals as ContextLocals
    if (search && typeof search === "string") {
        const filter: Filter<InventoryMongo> = {
            name: { $regex: search, $options: "i" }
        }
        if (after && typeof after === "string") {
            filter._id = { $lt: new ObjectId(after) };
        }
        const products = await inventory.find(filter).limit(limitParsed).sort({ $natural: -1 }).toArray()
        res.header("Cache-Control", "no-cache, no-store, must-revalidate");
        res.header("Pragma", "no-cache");
        res.header("Expires", "0");
        res.status(200).json(products)
    } else if (tag && typeof tag === "string") {
        const filter: Filter<InventoryMongo> = {
            tags: { $in: [tag] }
        }
        if (after && typeof after === "string") {
            filter._id = { $lt: new ObjectId(after) };
        }
        const products = await inventory.find(filter).limit(limitParsed).sort({ $natural: -1 }).toArray()
        res.header("Cache-Control", "no-cache, no-store, must-revalidate");
        res.header("Pragma", "no-cache");
        res.header("Expires", "0");
        res.status(200).json(products)
    } else if (discounts === "true") {
        const filter: Filter<InventoryMongo> = {
            use_discount: true
        }
        if (after && typeof after === "string") {
            filter._id = { $lt: new ObjectId(after) };
        }
        const products = await inventory.find(filter).limit(limitParsed).sort({ $natural: -1 }).toArray()
        res.header("Cache-Control", "no-cache, no-store, must-revalidate");
        res.header("Pragma", "no-cache");
        res.header("Expires", "0");
        res.status(200).json(products)
    } else {
        const filter: Filter<InventoryMongo> = {}
        if (after && typeof after === "string") {
            filter._id = { $lt: new ObjectId(after) };
        }
        const products = await inventory.find(filter).limit(limitParsed).sort({ $natural: -1 }).toArray()
        res.header("Cache-Control", "no-cache, no-store, must-revalidate");
        res.header("Pragma", "no-cache");
        res.header("Expires", "0");
        res.status(200).json(products)
    }
});

app.post('/inventory', async (req, res) => {
    try {
        const qty = req.body.qty
        const qtySmall = req.body.qtySmall
        const qtyBig = req.body.qtyBig
        const name = req.body.name
        const price = req.body.price
        const useSmallAndBig = req.body.useSmallAndBig
        const img = req.body.img as string[]
        const imgBig = req.body.imgBig as string[]
        const imgSmall = req.body.imgSmall as string[]
        const discountPrice = req.body.discountPrice
        const useDiscount = req.body.useDiscount
        const checkboxArete = req.body.checkboxArete
        const checkboxCollar = req.body.checkboxCollar
        const checkboxAnillo = req.body.checkboxAnillo
        const checkboxPulsera = req.body.checkboxPulsera
        const checkboxPiercing = req.body.checkboxPiercing
        const checkboxTobillera = req.body.checkboxTobillera
        const checkboxOro10K = req.body.checkboxOro10K
        const checkboxAjustable = req.body.checkboxAjustable
        const checkboxTalla5 = req.body.checkboxTalla5
        const checkboxTalla6 = req.body.checkboxTalla6
        const checkboxTalla7 = req.body.checkboxTalla7
        const checkboxTalla8 = req.body.checkboxTalla8
        const checkboxTalla9 = req.body.checkboxTalla9
        const checkboxTalla10 = req.body.checkboxTalla10
        const code = req.body.code
        if (typeof price !== "number") {
            throw new Error("Price is required and must be a number")
        }
        if (typeof name !== "string") {
            throw new Error("Name is required and must be a string")
        }
        if (typeof useSmallAndBig !== "boolean") {
            throw new Error("useSmallAndBig is required and must be a boolean")
        }
        if (useSmallAndBig) {
            if (!Array.isArray(imgBig)) {
                throw new Error("Images for big option are required and must be an array")
            }
            if (imgBig.length === 0) {
                throw new Error("Images for big option must include at least one image")
            }
            if (!imgBig.every(item => typeof item === "string")) {
                throw new Error("Images for big option must be strings")
            }
            if (typeof qtyBig !== "number") {
                throw new Error("Quantity Big is required and must be a number")
            }
            if (!Array.isArray(imgSmall)) {
                throw new Error("Images for small option are required and must be an array")
            }
            if (imgSmall.length === 0) {
                throw new Error("Images for small option must include at least one image")
            }
            if (!imgSmall.every(item => typeof item === "string")) {
                throw new Error("Images for small option must be strings")
            }
            if (typeof qtySmall !== "number") {
                throw new Error("Quantity Small is required and must be a number")
            }
        } else {
            if (!Array.isArray(img)) {
                throw new Error("Images are required and must be an array")
            }
            if (img.length === 0) {
                throw new Error("Images must include at least one image")
            }
            if (!img.every(item => typeof item === "string")) {
                throw new Error("Images must be strings")
            }
            if (typeof qty !== "number") {
                throw new Error("Quantity is required and must be a number")
            }
        }
        if (typeof discountPrice !== "number") {
            throw new Error("Discount price must be a number")
        }
        if (typeof useDiscount !== "boolean") {
            throw new Error("useDiscount must be a boolean")
        }
        if (typeof checkboxCollar !== "boolean") {
            throw new Error("checkboxCollar must be a boolean")
        }
        if (typeof checkboxAnillo !== "boolean") {
            throw new Error("checkboxAnillo must be a boolean")
        }
        if (typeof checkboxPulsera !== "boolean") {
            throw new Error("checkboxPulsera must be a boolean")
        }
        if (typeof checkboxPiercing !== "boolean") {
            throw new Error("checkboxPiercing must be a boolean")
        }
        if (typeof checkboxTobillera !== "boolean") {
            throw new Error("checkboxTobillera must be a boolean")
        }
        if (typeof checkboxOro10K !== "boolean") {
            throw new Error("checkboxOro10K must be a boolean")
        }
        if (typeof checkboxAjustable !== "boolean") {
            throw new Error("checkboxAjustable must be a boolean")
        }
        if (typeof checkboxTalla5 !== "boolean") {
            throw new Error("checkboxTalla5 must be a boolean")
        }
        if (typeof checkboxTalla6 !== "boolean") {
            throw new Error("checkboxTalla6 must be a boolean")
        }
        if (typeof checkboxTalla7 !== "boolean") {
            throw new Error("checkboxTalla7 must be a boolean")
        }
        if (typeof checkboxTalla8 !== "boolean") {
            throw new Error("checkboxTalla8 must be a boolean")
        }
        if (typeof checkboxTalla9 !== "boolean") {
            throw new Error("checkboxTalla9 must be a boolean")
        }
        if (typeof checkboxTalla10 !== "boolean") {
            throw new Error("checkboxTalla10 must be a boolean")
        }
        if (typeof checkboxArete !== "boolean") {
            throw new Error("checkboxArete must be a boolean")
        }
        if (typeof code !== "string") {
            throw new Error("Code must be a string")
        }
        const tags = []
        if (checkboxArete) {
            tags.push("arete")
        }
        if (checkboxCollar) {
            tags.push("collar")
        }
        if (checkboxAnillo) {
            tags.push("anillo")
        }
        if (checkboxPulsera) {
            tags.push("pulsera")
        }
        if (checkboxPiercing) {
            tags.push("piercing")
        }
        if (checkboxTobillera) {
            tags.push("tobillera")
        }
        if (checkboxOro10K) {
            tags.push("oro10k")
        }
        if (checkboxAjustable) {
            tags.push("ajustable")
        }
        if (checkboxTalla5) {
            tags.push("talla5")
        }
        if (checkboxTalla6) {
            tags.push("talla6")
        }
        if (checkboxTalla7) {
            tags.push("talla7")
        }
        if (checkboxTalla8) {
            tags.push("tall8")
        }
        if (checkboxTalla9) {
            tags.push("tall9")
        }
        if (checkboxTalla10) {
            tags.push("talla10")
        }
        const { inventory } = req.app.locals as ContextLocals
        const inventoryResult = await inventory.insertOne({
            available: qty,
            total: qty,
            name,
            price,
            img,
            discount_price: discountPrice,
            use_discount: useDiscount,
            tags,
            code,
            use_small_and_big: useSmallAndBig,
            img_big: imgBig,
            img_small: imgSmall,
            available_big: qtyBig,
            total_big: qtyBig,
            available_small: qtySmall,
            total_small: qtySmall,
        })
        generateProductHTML({
            _id: inventoryResult.insertedId,
            available: qty,
            total: qty,
            name,
            price,
            img,
            discount_price: discountPrice,
            use_discount: useDiscount,
            tags,
            code,
            use_small_and_big: useSmallAndBig,
            img_big: imgBig,
            img_small: imgSmall,
            available_big: qtyBig,
            total_big: qtyBig,
            available_small: qtySmall,
            total_small: qtySmall,
        })
        res.status(200).json("OK!")
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
});

app.patch('/inventory', async (req, res) => {
    try {
        const id = req.body.id
        const increment = req.body.increment || 0
        const incrementSmall = req.body.incrementSmall || 0
        const incrementBig = req.body.incrementBig || 0
        const name = req.body.name
        const price = req.body.price
        const code = req.body.code
        const discountPrice = req.body.discountPrice
        const useDiscount = req.body.useDiscount
        const checkboxArete = req.body.checkboxArete
        const checkboxCollar = req.body.checkboxCollar
        const checkboxAnillo = req.body.checkboxAnillo
        const checkboxPulsera = req.body.checkboxPulsera
        const checkboxPiercing = req.body.checkboxPiercing
        const checkboxTobillera = req.body.checkboxTobillera
        const checkboxOro10K = req.body.checkboxOro10K
        const checkboxAjustable = req.body.checkboxAjustable
        const checkboxTalla5 = req.body.checkboxTalla5
        const checkboxTalla6 = req.body.checkboxTalla6
        const checkboxTalla7 = req.body.checkboxTalla7
        const checkboxTalla8 = req.body.checkboxTalla8
        const checkboxTalla9 = req.body.checkboxTalla9
        const checkboxTalla10 = req.body.checkboxTalla10
        const useSmallAndBig = req.body.useSmallAndBig
        const img = req.body.img as string[]
        const imgBig = req.body.imgBig as string[]
        const imgSmall = req.body.imgSmall as string[]
        if (typeof id !== "string") {
            throw new Error("ID is required and must be a string")
        }
        if (id.length !== 24) {
            throw new Error("ID must contain 24 characters")
        }
        if (typeof discountPrice !== "number") {
            throw new Error("Price must be a number")
        }
        if (typeof price !== "number") {
            throw new Error("Price must be a number")
        }
        if (typeof name !== "string") {
            throw new Error("Name must be a string")
        }
        if (typeof useDiscount !== "boolean") {
            throw new Error("Name must be a boolean")
        }
        if (useSmallAndBig) {
            if (!Array.isArray(imgBig)) {
                throw new Error("Images for big option are required and must be an array")
            }
            if (imgBig.length === 0) {
                throw new Error("Images for big option must include at least one image")
            }
            if (!imgBig.every(item => typeof item === "string")) {
                throw new Error("Images for big option must be strings")
            }
            if (incrementBig && typeof incrementBig !== "number") {
                throw new Error("Quantity Big is required and must be a number")
            }
            if (!Array.isArray(imgSmall)) {
                throw new Error("Images for small option are required and must be an array")
            }
            if (imgSmall.length === 0) {
                throw new Error("Images for small option must include at least one image")
            }
            if (!imgSmall.every(item => typeof item === "string")) {
                throw new Error("Images for small option must be strings")
            }
            if (incrementSmall && typeof incrementSmall !== "number") {
                throw new Error("Quantity Small is required and must be a number")
            }
        } else {
            if (!Array.isArray(img)) {
                throw new Error("Images are required and must be an array")
            }
            if (img.length === 0) {
                throw new Error("Images must include at least one image")
            }
            if (!img.every(item => typeof item === "string")) {
                throw new Error("Images must be strings")
            }
            if (increment && typeof increment !== "number") {
                throw new Error("Increment must be a number")
            }
        }
        if (typeof checkboxCollar !== "boolean") {
            throw new Error("checkboxCollar must be a boolean")
        }
        if (typeof checkboxAnillo !== "boolean") {
            throw new Error("checkboxAnillo must be a boolean")
        }
        if (typeof checkboxPulsera !== "boolean") {
            throw new Error("checkboxPulsera must be a boolean")
        }
        if (typeof checkboxPiercing !== "boolean") {
            throw new Error("checkboxPiercing must be a boolean")
        }
        if (typeof checkboxTobillera !== "boolean") {
            throw new Error("checkboxTobillera must be a boolean")
        }
        if (typeof checkboxOro10K !== "boolean") {
            throw new Error("checkboxOro10K must be a boolean")
        }
        if (typeof checkboxAjustable !== "boolean") {
            throw new Error("checkboxAjustable must be a boolean")
        }
        if (typeof checkboxTalla5 !== "boolean") {
            throw new Error("checkboxTalla5 must be a boolean")
        }
        if (typeof checkboxTalla6 !== "boolean") {
            throw new Error("checkboxTalla6 must be a boolean")
        }
        if (typeof checkboxTalla7 !== "boolean") {
            throw new Error("checkboxTalla7 must be a boolean")
        }
        if (typeof checkboxTalla8 !== "boolean") {
            throw new Error("checkboxTalla8 must be a boolean")
        }
        if (typeof checkboxTalla9 !== "boolean") {
            throw new Error("checkboxTalla9 must be a boolean")
        }
        if (typeof checkboxTalla10 !== "boolean") {
            throw new Error("checkboxTalla10 must be a boolean")
        }
        if (typeof checkboxArete !== "boolean") {
            throw new Error("checkboxArete must be a boolean")
        }
        if (typeof code !== "string") {
            throw new Error("Code must be a string")
        }
        const tags = []
        if (checkboxArete) {
            tags.push("arete")
        }
        if (checkboxCollar) {
            tags.push("collar")
        }
        if (checkboxAnillo) {
            tags.push("anillo")
        }
        if (checkboxPulsera) {
            tags.push("pulsera")
        }
        if (checkboxPiercing) {
            tags.push("piercing")
        }
        if (checkboxTobillera) {
            tags.push("tobillera")
        }
        if (checkboxOro10K) {
            tags.push("oro10k")
        }
        if (checkboxAjustable) {
            tags.push("ajustable")
        }
        if (checkboxTalla5) {
            tags.push("talla5")
        }
        if (checkboxTalla6) {
            tags.push("talla6")
        }
        if (checkboxTalla7) {
            tags.push("talla7")
        }
        if (checkboxTalla8) {
            tags.push("tall8")
        }
        if (checkboxTalla9) {
            tags.push("tall9")
        }
        if (checkboxTalla10) {
            tags.push("talla10")
        }
        const { inventory } = req.app.locals as ContextLocals
        const product_oid = new ObjectId(id)
        const filter: Filter<InventoryMongo> = {
            _id: product_oid,
        }
        if (increment) {
            filter.available = {
                $gte: -increment
            }
        }
        if (incrementBig) {
            filter.available_big = {
                $gte: -incrementBig
            }
        }
        if (incrementSmall) {
            filter.available_small = {
                $gte: -incrementSmall
            }
        }
        const result = await inventory.findOneAndUpdate(
            filter,
            {
                ...(increment ? {
                    $inc: {
                        available: increment,
                        total: increment,
                    }
                } : {}),
                ...(incrementBig ? {
                    $inc: {
                        available_big: incrementBig,
                        total_big: incrementBig,
                    }
                } : {}),
                ...(incrementSmall ? {
                    $inc: {
                        available_small: incrementSmall,
                        total_small: incrementSmall,
                    }
                } : {}),
                $set: {
                    name,
                    price,
                    discount_price: discountPrice,
                    use_discount: useDiscount,
                    tags,
                    code,
                    use_small_and_big: useSmallAndBig,
                    img_big: imgBig,
                    img_small: imgSmall,
                }
            },
            {
                returnDocument: "after",
            })
        const { value } = result
        if (!value) {
            throw new Error("Not enough inventory or product not found")
        }
        generateProductHTML(value)
        res.status(200).json({
            product: result.value
        })
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
});

app.post('/register', async (req, res) => {
    try {
        const email = req.body.email
        const password = req.body.password
        const confirmPassword = req.body.confirmPassword
        const name = req.body.name
        const apellidos = req.body.apellidos
        const phonePrefix = req.body.phonePrefix
        const phone = req.body.phone
        if (!email || typeof email !== "string") {
            throw new Error("Email is required and must be a string")
        }
        if (!password || typeof password !== "string") {
            throw new Error("Password is required and must be a string")
        }
        if (password.length < 8) {
            throw new Error("Password must have at least 8 characters")
        }
        if (password !== confirmPassword) {
            throw new Error("Confirm Password must be the same as Password")
        }
        if (!name || typeof name !== "string") {
            throw new Error("Name is required and must be a string")
        }
        if (!apellidos || typeof apellidos !== "string") {
            throw new Error("Apellidos is required and must be a string")
        }
        if (!phone || typeof phone !== "string") {
            throw new Error("Phone is required and must be a string")
        }
        if (phonePrefix !== "+52") {
            throw new Error("Phone must be from Mexico")
        }
        const { users, cartsByUser } = req.app.locals as ContextLocals
        const cart_id = new ObjectId();
        const user_id = new ObjectId();
        const user = await users.findOne({ email });
        if (user) throw new Error("El email ya esta siendo usado.");
        const [customer, hash_password] = await Promise.all([
            customerClient.createCustomer({
                name: `${name} ${apellidos}`,
                email,
                phone: phonePrefix + phone,
            }),
            bcrypt.hash(password, 12),
        ])
        const now = new Date();
        now.setMilliseconds(0);
        const nowTime = now.getTime() / 1000;
        const refreshTokenExpireTime = nowTime + REFRESH_TOKEN_EXP_NUMBER;
        const accessTokenExpireTime = nowTime + ACCESS_TOKEN_EXP_NUMBER;
        const refreshToken = jwt.sign(
            {
                user: {
                    _id: user_id.toHexString(),
                    cart_id: cart_id.toHexString(),
                    is_admin: false,
                },
                refreshTokenExpireTime: refreshTokenExpireTime,
                exp: refreshTokenExpireTime,
            },
            REFRESHSECRET
        );
        const accessToken = jwt.sign(
            {
                user: {
                    _id: user_id.toHexString(),
                    cart_id: cart_id.toHexString(),
                    is_admin: false,
                },
                refreshTokenExpireTime: refreshTokenExpireTime,
                exp: accessTokenExpireTime,
            },
            ACCESSSECRET
        );
        const refreshTokenExpireDate = new Date(refreshTokenExpireTime * 1000);
        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            expires: refreshTokenExpireDate,
            secure: true,
        });
        const userData = {
            _id: user_id,
            email,
            password: hash_password,
            cart_id,
            name,
            apellidos,
            conekta_id: customer.data.id,
            phone,
            default_address: null,
            addresses: [],
            phone_prefix: phonePrefix,
            is_admin: false,
        }
        await Promise.all([
            users.insertOne(userData),
            cartsByUser.insertOne({
                _id: cart_id,
                user_id,
                expireDate: null
            }),
        ])
        res.setHeader("accessToken", accessToken)
        res.status(200).json({
            user: userData
        })
    } catch (e) {
        if (e instanceof AxiosError) {
            res.status(400).json(e.response?.data?.details?.[0].message)
        } if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
});

app.post('/log-out', async (_req, res) => {
    res.clearCookie("refreshToken")
    res.setHeader("accessToken", "")
    res.status(200).json("Ok!")
})

app.patch('/user', async (req, res) => {
    try {
        const ctx = Context.get(req);
        if (!ctx?.userJWT?.user._id) {
            throw new Error("Inicia sesión primero")
        }
        const email = req.body.email
        const name = req.body.name
        const apellidos = req.body.apellidos
        const phonePrefix = req.body.phonePrefix
        const phone = req.body.phone
        const { users } = req.app.locals as ContextLocals
        if (!email || typeof email !== "string") {
            throw new Error("Email is required and must be a string")
        }
        if (!name || typeof name !== "string") {
            throw new Error("Name is required and must be a string")
        }
        if (!apellidos || typeof apellidos !== "string") {
            throw new Error("Apellidos is required and must be a string")
        }
        if (!phone || typeof phone !== "string") {
            throw new Error("Phone is required and must be a string")
        }
        if (phonePrefix !== "+52") {
            throw new Error("Phone must be from Mexico")
        }
        const user_oid = new ObjectId(ctx?.userJWT?.user._id)
        const user = await users.findOneAndUpdate(
            { _id: user_oid },
            {
                $set: {
                    name,
                    email,
                    apellidos,
                    phone,
                    phone_prefix: phonePrefix,
                }
            },
            {
                returnDocument: "after",
            }
        );
        res.status(200).json({
            user: {
                ...user.value,
                password: undefined,
            },
        })
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
})

app.post('/log-in', async (req, res) => {
    try {
        const email = req.body.email
        const password = req.body.password
        if (email && typeof email !== "string") {
            throw new Error("Email is required and must be a string")
        }
        if (password && typeof password !== "string") {
            throw new Error("Password is required and must be a string")
        }
        if (password.length < 8) {
            throw new Error("Password must have at least 8 characters")
        }
        const { users } = req.app.locals as ContextLocals
        const user = await users.findOne({
            email,
        })
        if (!user) throw new Error("El usuario no existe.");
        const hash = await bcrypt.compare(password, user.password);
        if (!hash) throw new Error("La contraseña no coincide.");
        const now = new Date();
        now.setMilliseconds(0);
        const nowTime = now.getTime() / 1000;
        const refreshTokenExpireTime = nowTime + REFRESH_TOKEN_EXP_NUMBER;
        const accessTokenExpireTime = nowTime + ACCESS_TOKEN_EXP_NUMBER;
        const refreshToken = jwt.sign(
            {
                user: {
                    _id: user._id.toHexString(),
                    cart_id: user.cart_id.toHexString(),
                    is_admin: user.is_admin,
                },
                refreshTokenExpireTime: refreshTokenExpireTime,
                exp: refreshTokenExpireTime,
            },
            REFRESHSECRET
        );
        const accessToken = jwt.sign(
            {
                user: {
                    _id: user._id.toHexString(),
                    cart_id: user.cart_id.toHexString(),
                    is_admin: user.is_admin,
                },
                refreshTokenExpireTime: refreshTokenExpireTime,
                exp: accessTokenExpireTime,
            },
            ACCESSSECRET
        );
        const refreshTokenExpireDate = new Date(refreshTokenExpireTime * 1000);
        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            expires: refreshTokenExpireDate,
            secure: true,
        });
        res.setHeader("accessToken", accessToken)
        res.status(200).json({
            user: {
                ...user,
                password: undefined
            }
        })
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
});

app.post('/add-to-cart', async (req, res) => {
    try {
        const ctx = Context.get(req);
        const { inventory, itemsByCart, reservedInventory, cartsByUser } = req.app.locals as ContextLocals
        const product_id = req.body.product_id
        const qty = req.body.qty || 0
        const qtyBig = req.body.qtyBig || 0
        const qtySmall = req.body.qtySmall || 0
        if (product_id && typeof product_id !== "string") {
            throw new Error("Product ID is required and must be a string")
        }
        if (product_id.length !== 24) {
            throw new Error("Product ID must contain 24 characters")
        }
        if (qty && typeof qty !== "number") {
            throw new Error("Quantity is required and must be a number")
        }
        if (qtyBig && typeof qtyBig !== "number") {
            throw new Error("Quantity Big is required and must be a number")
        }
        if (qtySmall && typeof qtySmall !== "number") {
            throw new Error("Quantity Small is required and must be a number")
        }
        const cart_oid = new ObjectId(ctx?.userJWT?.user.cart_id || ctx?.sessionCookie?.cart_id)
        const product_oid = new ObjectId(product_id)
        const filter: Filter<InventoryMongo> = {
            _id: product_oid
        }
        if (qty) {
            filter.available = {
                $gte: qty
            }
        }
        if (qtyBig) {
            filter.available_big = {
                $gte: qtyBig
            }
        }
        if (qtySmall) {
            filter.available_small = {
                $gte: qtySmall
            }
        }
        const product = await inventory.findOneAndUpdate(
            filter,
            {
                $inc: {
                    available: -qty,
                    available_big: -qtyBig,
                    available_small: -qtySmall,
                }
            },
            {
                returnDocument: "after"
            })
        const { value } = product
        if (!value) {
            throw new Error("Not enough inventory or product not found")
        }
        generateProductHTML(value)
        const expireDate = new Date()
        expireDate.setDate(expireDate.getDate() + 7)
        const reserved = await reservedInventory.updateOne({
            cart_id: cart_oid,
            product_id: product_oid,
        },
            {
                $inc: {
                    qty,
                    qty_big: qtyBig,
                    qty_small: qtySmall,
                },
                $setOnInsert: {
                    cart_id: cart_oid,
                    product_id: product_oid,
                },
            },
            {
                upsert: true
            })
        if (!(reserved.modifiedCount || reserved.upsertedCount)) {
            throw new Error("Item not reserved.")
        }
        const result = await itemsByCart.updateOne(
            {
                product_id: product_oid,
                cart_id: cart_oid,
            },
            {
                $inc: {
                    qty,
                    qty_big: qtyBig,
                    qty_small: qtySmall,
                },
                $setOnInsert: {
                    name: value.name,
                    product_id: product_oid,
                    cart_id: cart_oid,
                    price: value.price,
                    discount_price: value.discount_price,
                    use_discount: value.use_discount,
                    img: value.img,
                    code: value.code,
                    img_big: value.img_big,
                    img_small: value.img_small,
                    use_small_and_big: value.use_small_and_big,
                }
            },
            {
                upsert: true
            }
        )
        if (!(result.modifiedCount || result.upsertedCount)) {
            throw new Error("Item not added to cart.")
        }
        await cartsByUser.updateOne({
            _id: cart_oid,
        },
            {
                $set: {
                    expireDate
                }
            })
        res.status(200).json("OK!")
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
});

app.patch('/add-to-cart', async (req, res) => {
    try {
        const ctx = Context.get(req);
        const { inventory, itemsByCart, reservedInventory, cartsByUser } = req.app.locals as ContextLocals
        const item_by_cart_id = req.body.item_by_cart_id
        const product_id = req.body.product_id
        const qty = req.body.qty || 0
        const qtyBig = req.body.qtyBig || 0
        const qtySmall = req.body.qtySmall || 0
        if (product_id && typeof product_id !== "string") {
            throw new Error("Product ID is required and must be a string")
        }
        if (product_id.length !== 24) {
            throw new Error("Product ID must contain 24 characters")
        }
        if (item_by_cart_id && typeof item_by_cart_id !== "string") {
            throw new Error("Product cart ID is required and must be a string")
        }
        if (item_by_cart_id.length !== 24) {
            throw new Error("Product cart ID must contain 24 characters")
        }
        if (typeof qty !== "number") {
            throw new Error("Quantity is required and must be a number")
        }
        if (typeof qtyBig !== "number") {
            throw new Error("Quantity Big is required and must be a number")
        }
        if (typeof qtySmall !== "number") {
            throw new Error("Quantity Small is required and must be a number")
        }
        const cart_oid = new ObjectId(ctx?.userJWT?.user.cart_id || ctx?.sessionCookie?.cart_id)
        const product_oid = new ObjectId(product_id)
        const reserved = await reservedInventory.findOneAndDelete({
            cart_id: cart_oid,
            product_id: product_oid,
        })
        if (!reserved.value) {
            throw new Error("Item not reserved.")
        }
        const filter: Filter<InventoryMongo> = {
            _id: product_oid,
        }
        if (qty) {
            filter.available = {
                $gte: qty - reserved.value.qty,
            }
        }
        if (qtyBig) {
            filter.available_big = {
                $gte: qtyBig - reserved.value.qty_big,
            }
        }
        if (qtySmall) {
            filter.available_small = {
                $gte: qtySmall - reserved.value.qty_small,
            }
        }
        const product = await inventory.findOneAndUpdate(
            filter,
            {
                $inc: {
                    available: reserved.value.qty - qty,
                    available_big: reserved.value.qty_big - qtyBig,
                    available_small: reserved.value.qty_small - qtySmall,
                },
            },
            {
                returnDocument: "after"
            })
        const { value } = product
        if (!value) {
            throw new Error("Not enough inventory or product not found")
        }
        generateProductHTML(value)
        const item_by_cart_oid = new ObjectId(item_by_cart_id)
        const result = await itemsByCart.updateOne(
            {
                _id: item_by_cart_oid,
                cart_id: cart_oid,
            },
            {
                $set: {
                    qty,
                    qty_big: qtyBig,
                    qty_small: qtySmall,
                },
            },
        )
        if (!result.modifiedCount) {
            throw new Error("Item in cart not modified.")
        }
        const expireDate = new Date()
        expireDate.setDate(expireDate.getDate() + 7)
        const newReserved = await reservedInventory.insertOne(
            {
                qty,
                cart_id: cart_oid,
                product_id: product_oid,
                qty_big: qtyBig,
                qty_small: qtySmall,
            })
        if (!newReserved.insertedId) {
            throw new Error("Item not reserved.")
        }
        await cartsByUser.updateOne({
            _id: cart_oid,
        },
            {
                $set: {
                    expireDate
                }
            })
        res.status(200).json("OK!")
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
});

app.get('/add-to-cart', async (req, res) => {
    try {
        const ctx = Context.get(req);
        const { itemsByCart } = req.app.locals as ContextLocals
        const cart_oid = new ObjectId(ctx?.userJWT?.user.cart_id || ctx?.sessionCookie?.cart_id)
        const itemsInCart = await itemsByCart.find({ cart_id: cart_oid }).toArray()
        res.header("Cache-Control", "no-cache, no-store, must-revalidate");
        res.header("Pragma", "no-cache");
        res.header("Expires", "0");
        res.status(200).json(itemsInCart)
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
})

app.delete('/add-to-cart', async (req, res) => {
    try {
        const ctx = Context.get(req);
        const item_by_cart_id = req.body.item_by_cart_id
        const { itemsByCart, reservedInventory, inventory } = req.app.locals as ContextLocals
        if (item_by_cart_id && typeof item_by_cart_id !== "string") {
            throw new Error("Product ID is required and must be a string")
        }
        if (item_by_cart_id.length !== 24) {
            throw new Error("Product ID must contain 24 characters")
        }
        const cart_oid = new ObjectId(ctx?.userJWT?.user.cart_id || ctx?.sessionCookie?.cart_id)
        const item_by_cart_oid = new ObjectId(item_by_cart_id)
        const result = await itemsByCart.findOneAndDelete(
            {
                _id: item_by_cart_oid,
                cart_id: cart_oid
            },
        )
        if (!result.value) {
            throw new Error("Item in cart was not deleted.")
        }
        const reservation = await reservedInventory.findOneAndDelete(
            {
                product_id: result.value.product_id,
                cart_id: cart_oid,
            })
        if (!reservation.value) {
            throw new Error("Item in reservation was not deleted.")
        }
        const product = await inventory.findOneAndUpdate({
            _id: result.value.product_id,
        },
            {
                $inc: {
                    available: reservation.value.qty,
                    available_small: reservation.value.qty_small,
                    available_big: reservation.value.qty_big,
                },
            })
        const { value } = product
        if (!value) {
            throw new Error("Inventory not modified.")
        }
        generateProductHTML(value)
        res.status(200).json("Ok")
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
})

app.post('/checkout', async (req, res) => {
    try {
        const ctx = Context.get(req);
        const { itemsByCart, sessions, users } = req.app.locals as ContextLocals
        const { name, apellidos, street, email, country, colonia, zip, city, state, phone, address_id, phone_prefix } = req.body
        if (!name || typeof name !== "string") {
            throw new Error("Name is required and must be a string")
        }
        if (!apellidos || typeof apellidos !== "string") {
            throw new Error("Apellidos is required and must be a string")
        }
        if (!street || typeof street !== "string") {
            throw new Error("Street is required and must be a string")
        }
        if (!country || typeof country !== "string") {
            throw new Error("Country is required and must be a string")
        }
        if (!colonia || typeof colonia !== "string") {
            throw new Error("Colonia is required and must be a string")
        }
        if (!zip || typeof zip !== "string") {
            throw new Error("Zip Code is required and must be a string")
        }
        if (!city || typeof city !== "string") {
            throw new Error("City is required and must be a string")
        }
        if (!state || typeof state !== "string") {
            throw new Error("State is required and must be a string")
        }
        if (!phone || typeof phone !== "string") {
            throw new Error("Phone is required and must be a string")
        }
        if (!phone_prefix || phone_prefix !== "+52") {
            throw new Error("Phone is required and must from Mexico")
        }
        const cart_oid = new ObjectId(ctx?.userJWT?.user.cart_id || ctx?.sessionCookie?.cart_id)
        if (address_id && typeof address_id === "string" && ctx?.userJWT) {
            const address_oid = new ObjectId(address_id)
            const user_oid = new ObjectId(ctx.userJWT.user._id)
            const result = await users.findOneAndUpdate({
                _id: user_oid,
                "addresses._id": address_oid,
            },
                {
                    $set: {
                        default_address: address_oid,
                        "addresses.$.full_address": `${street}, ${colonia}, ${zip} ${city} ${state}, ${country} (${name} ${apellidos})`,
                        "addresses.$.country": country,
                        "addresses.$.street": street,
                        "addresses.$.colonia": colonia,
                        "addresses.$.zip": zip,
                        "addresses.$.city": city,
                        "addresses.$.state": state,
                        "addresses.$.phone": phone,
                        "addresses.$.name": name,
                        "addresses.$.apellidos": apellidos,
                    },
                },
                {
                    returnDocument: "after"
                })
            if (!result.value) {
                throw new Error("No user updated")
            }
            const user = result.value
            const products = await itemsByCart.find({ cart_id: cart_oid }).toArray()
            const order = await orderClient.createOrder({
                currency: "MXN",
                customer_info: {
                    customer_id: result.value.conekta_id,
                },
                line_items: products.map(product => ({
                    name: product.name,
                    unit_price: product.use_discount ? product.discount_price : product.price,
                    quantity: product.use_small_and_big ? product.qty_big ? product.qty_big : product.qty_small : product.qty,
                })),
                checkout: {
                    type: 'Integration',
                    allowed_payment_methods: ['card', 'cash', 'bank_transfer'],
                }
            })
            return res.status(200).json({
                user: {
                    ...user,
                    password: undefined,
                },
                checkout_id: order?.data?.checkout?.id
            })
        } else if (ctx?.userJWT) {
            const address_id = new ObjectId()
            const user_oid = new ObjectId(ctx.userJWT.user._id)
            const result = await users.findOneAndUpdate({
                _id: user_oid,
            },
                {
                    $set: {
                        default_address: address_id,
                    },
                    $push: {
                        addresses: {
                            _id: address_id,
                            full_address: `${street}, ${colonia}, ${zip} ${city} ${state}, ${country} (${name} ${apellidos})`,
                            country,
                            street,
                            colonia,
                            zip,
                            city,
                            state,
                            phone,
                            name,
                            apellidos,
                            phone_prefix,
                        }
                    },
                },
                {
                    returnDocument: "after"
                })
            if (!result.value) {
                throw new Error("No user updated")
            }
            const user = result.value
            const products = await itemsByCart.find({ cart_id: cart_oid }).toArray()
            const order = await orderClient.createOrder({
                currency: "MXN",
                customer_info: {
                    customer_id: result.value.conekta_id,
                },
                line_items: products.map(product => ({
                    name: product.name,
                    unit_price: product.use_discount ? product.discount_price : product.price,
                    quantity: product.use_small_and_big ? product.qty_big ? product.qty_big : product.qty_small : product.qty,
                })),
                checkout: {
                    type: 'Integration',
                    allowed_payment_methods: ['card', 'cash', 'bank_transfer'],
                }
            })
            return res.status(200).json({
                user: {
                    ...user,
                    password: undefined
                },
                checkout_id: order?.data?.checkout?.id
            })
        } else {
            if (!email && typeof email !== "string") {
                throw new Error("Email is required and must be a string")
            }
            const session_oid = new ObjectId(ctx?.sessionCookie?._id)
            const result = await sessions.findOneAndUpdate({
                _id: session_oid,
            },
                {
                    $set: {
                        email,
                        country,
                        street,
                        colonia,
                        zip,
                        city,
                        state,
                        phone,
                        name,
                        apellidos,
                        phone_prefix,
                    },
                },
                {
                    returnDocument: "after"
                })
            if (!result.value) {
                throw new Error("No session updated")
            }
            const conekta_id = result.value.conekta_id ?? (await customerClient.createCustomer({ phone, name: `${name} ${apellidos}`, email })).data.id
            if (!result.value.conekta_id) {
                await sessions.updateOne({
                    _id: session_oid,
                },
                    {
                        $set: {
                            conekta_id,
                        }
                    })
            }
            const products = await itemsByCart.find({ cart_id: cart_oid }).toArray()
            const order = await orderClient.createOrder({
                currency: "MXN",
                customer_info: {
                    customer_id: conekta_id,
                },
                line_items: products.map(product => ({
                    name: product.name,
                    unit_price: product.use_discount ? product.discount_price : product.price,
                    quantity: product.use_small_and_big ? product.qty_big ? product.qty_big : product.qty_small : product.qty,
                })),
                checkout: {
                    type: 'Integration',
                    allowed_payment_methods: ['card', 'cash', 'bank_transfer'],
                }
            })
            result.value.conekta_id = conekta_id
            res.cookie("session", JSON.stringify(result.value), {
                secure: true,
            })
            res.status(200).json({
                checkout_id: order?.data?.checkout?.id
            })
        }
    } catch (e) {
        if (e instanceof AxiosError) {
            res.status(400).json(e.response?.data?.details?.[0].message)
        } else if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
})

app.post('/confirmation', async (req, res) => {
    try {
        const ctx = Context.get(req);
        const { users, cartsByUser, sessions, purchases, itemsByCart } = req.app.locals as ContextLocals
        const new_cart_id = new ObjectId()
        const previous_cart_id = new ObjectId(ctx?.userJWT?.user.cart_id || ctx?.sessionCookie?.cart_id)
        const session_oid = new ObjectId(ctx?.sessionCookie?._id)
        if (ctx?.userJWT) {
            const user_oid = new ObjectId(ctx.userJWT.user._id)
            const [user] = await Promise.all([users.findOneAndUpdate({
                _id: user_oid
            }, {
                $set: {
                    cart_id: new_cart_id
                }
            },
                {
                    returnDocument: "after"
                }),
            cartsByUser.bulkWrite([
                {
                    updateOne: {
                        filter: {
                            _id: previous_cart_id
                        },
                        update: {
                            $set: {
                                expireDate: null
                            }
                        }
                    },
                    insertOne: {
                        document: {
                            _id: new_cart_id,
                            user_id: user_oid,
                            expireDate: null
                        }
                    }
                }
            ])
            ])
            const productsInCart = await itemsByCart.find({ cart_id: previous_cart_id }).toArray()
            const purchasedProducts: PurchasesMongo[] = productsInCart.map(product => ({
                name: product.name,
                product_id: product.product_id,
                qty: product.qty,
                qty_big: product.qty_big,
                qty_small: product.qty_small,
                price: product.price,
                discount_price: product.discount_price,
                use_discount: product.use_discount,
                user_id: user_oid,
                session_id: session_oid,
                date: new Date(),
                img: product.img,
                code: product.code,
                use_small_and_big: product.use_small_and_big,
                img_big: product.img_big,
                img_small: product.img_small,
            }))
            await purchases.insertMany(purchasedProducts)
            const newAccessToken = jwt.sign(
                {
                    user: {
                        _id: ctx.userJWT.user._id,
                        cart_id: new_cart_id.toHexString(),
                        is_admin: ctx.userJWT.user.is_admin,
                    },
                    refreshTokenExpireTime: ctx.userJWT.refreshTokenExpireTime,
                    exp: ctx.userJWT.exp,
                },
                ACCESSSECRET
            );
            const refreshToken = jwt.sign(
                {
                    user: {
                        _id: ctx.userJWT.user._id,
                        cart_id: new_cart_id.toHexString(),
                        is_admin: ctx.userJWT.user.is_admin,
                    },
                    refreshTokenExpireTime: ctx.userJWT.refreshTokenExpireTime,
                    exp: ctx.userJWT.exp,
                },
                REFRESHSECRET
            );
            const refreshTokenExpireDate = new Date(ctx.userJWT.refreshTokenExpireTime * 1000);
            res.cookie("refreshToken", refreshToken, {
                httpOnly: true,
                expires: refreshTokenExpireDate,
                secure: true,
            });
            res.setHeader("accessToken", newAccessToken)
            return res.status(200).json({
                user: {
                    ...user.value,
                    password: undefined,
                }
            })
        } else {
            const [session] = await Promise.all([
                sessions.findOneAndUpdate(
                    {
                        _id: session_oid
                    },
                    {
                        $set: {
                            cart_id: new_cart_id
                        }
                    },
                    {
                        returnDocument: "after"
                    }
                ),
                cartsByUser.bulkWrite([
                    {
                        updateOne: {
                            filter: {
                                _id: previous_cart_id
                            },
                            update: {
                                $set: {
                                    expireDate: null
                                }
                            }
                        },
                        insertOne: {
                            document: {
                                _id: new_cart_id,
                                user_id: session_oid,
                                expireDate: null
                            }
                        }
                    }
                ])

            ])
            const productsInCart = await itemsByCart.find({ cart_id: previous_cart_id }).toArray()
            const purchasedProducts: PurchasesMongo[] = productsInCart.map(product => ({
                name: product.name,
                product_id: product._id,
                qty: product.qty,
                qty_small: product.qty_small,
                qty_big: product.qty_big,
                price: product.price,
                discount_price: product.discount_price,
                use_discount: product.use_discount,
                user_id: null,
                session_id: session_oid,
                date: new Date(),
                img: product.img,
                code: product.code,
                use_small_and_big: product.use_small_and_big,
                img_big: product.img_big,
                img_small: product.img_small,
            }))
            await purchases.insertMany(purchasedProducts)
            if (session.value) {
                res.cookie("session", JSON.stringify(session.value), {
                    secure: true,
                })
            }
            return res.status(200).json({
                user: null,
            })
        }
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
});

app.get('/purchases', async (req, res) => {
    try {
        const ctx = Context.get(req);
        if (!ctx?.userJWT?.user._id) {
            throw new Error("Inicia sesión primero")
        }
        const { purchases } = req.app.locals as ContextLocals
        const user_oid = new ObjectId(ctx?.userJWT?.user._id)
        const history = await purchases.find({ user_id: user_oid }).toArray()
        res.header("Cache-Control", "no-cache, no-store, must-revalidate");
        res.header("Pragma", "no-cache");
        res.header("Expires", "0");
        res.status(200).json(history)
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
})

app.post('/signed-url', async (req, res) => {
    try {
        const { fileType } = req.body
        if (typeof fileType !== "string") {
            throw new Error("fileType is required and must be a string")
        }
        const ex = fileType.split("/")[1];
        const Key = `${randomUUID()}.${ex}`;
        const putObjectParams = {
            Bucket: BUCKET_NAME,
            Key,
            ContentType: `image/${ex}`,
        };
        const command = new PutObjectCommand(putObjectParams);
        const uploadUrl = await getSignedUrl(clientS3, command, { expiresIn: 3600 });
        res.status(200).json({
            uploadUrl,
            key: Key,
        });
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
})

app.get('*', async (req, res) => {
    try {
        if (req.path === "/") {
            const template = fs.readFileSync(`static/main.html`, 'utf-8');
            return res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
        }
        if (req.path.includes(".ico")) {
            const template = fs.readFileSync(`static/${req.path}`, 'binary');
            return res.status(200).set({ 'Content-Type': 'image/x-icon' }).end(template, 'binary');
        }
        if (req.path.includes(".png")) {
            const template = fs.readFileSync(`static/${req.path}`, 'binary');
            return res.status(200).set({ 'Content-Type': 'image/x-png' }).end(template, 'binary');
        }
        if (req.path.includes(".webp")) {
            const template = fs.readFileSync(`static/${req.path}`, 'binary');
            return res.status(200).set({ 'Content-Type': 'image/webp' }).end(template, 'binary');
        }
        if (req.path.includes(".svg")) {
            const template = fs.readFileSync(`static/${req.path}`, 'binary');
            return res.status(200).set({ 'Content-Type': 'image/svg' }).end(template, 'binary');
        }
        if (req.path.includes(".js")) {
            const template = fs.readFileSync(`static/${req.path}`, 'utf-8');
            return res.status(200).set({ 'Content-Type': 'application/javascript' }).end(template);
        }
        if (req.path.includes(".css")) {
            const template = fs.readFileSync(`static/${req.path}`, 'utf-8');
            return res.status(200).set({ 'Content-Type': 'text/css' }).end(template);
        }
        if (req.path === "/inventory-admin") {
            const ctx = Context.get(req);
            if (!ctx?.userJWT?.user.is_admin) {
                return res.redirect("/")
            }
        }
        const template = fs.readFileSync(`static/${req.path}.html`, 'utf-8');
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (e) {
        if (e instanceof Error) {
            res.status(400).json({ message: e.message })
        } else {
            res.status(400).json({ message: "Error" })
        }
    }
});

//Define site pages
//Copiar estilos de https://www.fourb.online/ y hacerlo responsive (prio)
//Copiar un poco del inventario (prio)
//Keep session if active user? (delay)
//Keep cart if active user? (delay)
//Do not store session in database? (delay)
//SEO (delay)
//Big y small (prio)
//3 opciones de entrega (prio)
//Reduce costs! Beanstalk to single EC2 instance? Use rust? Drop AWS?

MongoClient.connect(MONGO_DB || "mongodb://mongo-fourb:27017", {}).then(async (client) => {
    const db = client.db("fourb");
    app.locals.users = db.collection("users")
    app.locals.cartsByUser = db.collection("carts_by_user")
    app.locals.inventory = db.collection("inventory")
    app.locals.itemsByCart = db.collection("items_by_cart")
    app.locals.reservedInventory = db.collection("reserved_inventory")
    app.locals.sessions = db.collection("sessions")
    app.locals.purchases = db.collection("purchases")
    cron.schedule('0 3 * * *', async () => {
        const cartsByUser = db.collection<CartsByUserMongo>("carts_by_user")
        const itemsByCart = db.collection<ItemsByCartMongo>("items_by_cart")
        const inventory = db.collection<InventoryMongo>("inventory")
        const reservedInventory = db.collection<ReservedInventoryMongo>("reserved_inventory")
        const carts = await cartsByUser.find({ expireDate: { $ne: null } }).toArray()
        const now = (new Date).getTime()
        for (const cart of carts) {
            if (cart?.expireDate) {
                const cartExpireTime = cart.expireDate.getTime()
                if (cartExpireTime < now) {
                    const items = await itemsByCart.find({ cart_id: cart._id }).toArray()
                    for (const item of items) {
                        await inventory.updateOne({
                            _id: item.product_id
                        },
                        {
                            $inc: {
                                available: item.qty,
                                available_big: item.qty_big,
                                available_small: item.qty_small,
                            }
                        })
                    }
                    await itemsByCart.deleteMany({ cart_id: cart._id })
                    await reservedInventory.deleteMany({ cart_id: cart._id })
                    await cartsByUser.updateOne({ _id: cart._id }, { $set: { expireDate: null } })
                }
            }
        }
    }, {
        scheduled: true,
        timezone: "America/Cancun"
    });
    app.listen(PORT)
})


