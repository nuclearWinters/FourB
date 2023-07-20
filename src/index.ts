import fs from 'fs';
import express from 'express'
import { Collection, MongoClient, ObjectId } from "mongodb";
import { MONGO_DB } from "./config";
import Handlebars from 'handlebars';
import bcrypt from "bcryptjs"
import jsonwebtoken, { SignOptions } from "jsonwebtoken"
import cookieParser from "cookie-parser"
import { CustomersApi, Configuration, OrdersApi } from 'conekta';
import { Request } from 'express';
import { AxiosError } from "axios"

const apikey = "key_pMkl11iWacZYSvetll0CaMc";
const config = new Configuration({ accessToken: apikey });
const customerClient = new CustomersApi(config);
const orderClient = new OrdersApi(config);

export const REFRESH_TOKEN_EXP_NUMBER = 900;
export const ACCESS_TOKEN_EXP_NUMBER = 180;
export const REFRESHSECRET = process.env.REFRESHSECRET || "REFRESHSECRET";
export const ACCESSSECRET = process.env.ACCESSSECRET || "ACCESSSECRET";
export const NODE_ENV = process.env.NODE_ENV || "development";

class Context {
  static _bindings = new WeakMap<Request, Context>();
  
  public userJWT: DecodeJWT | null = null;
  public sessionCookie: SessionCookie | null = null;
   
  constructor () {}
    
  static bind(req: Request) : void {
    const ctx = new Context();
    Context._bindings.set(req, ctx);
  }
    
  static get(req: Request) : Context | null {
    return Context._bindings.get(req) || null;
  }
}

interface UserMongo {
    _id?: ObjectId;
    email: string;
    password: string;
    cart_id: ObjectId;
    name: string;
    apellidos: string;
    phone: string;
    conekta_id: string;
    default_address: ObjectId | null;
    addresses: AddressUser[]
    phone_prefix: string;
    is_admin: boolean;
}

interface AddressUser {
    _id: ObjectId;
    full_address: string;
    country: string;
    street: string;
    colonia: string;
    zip: string;
    city: string;
    state: string;
    phone: string;
    name: string;
    apellidos: string;
}

interface AddressUserJWT {
    _id: string;
    full_address: string;
    country: string;
    street: string;
    colonia: string;
    zip: string;
    city: string;
    state: string;
    phone: string;
    name: string;
    apellidos: string;
}

interface SessionMongo {
    _id?: ObjectId;
    email: string | null;
    cart_id: ObjectId;
    name: string | null;
    apellidos: string | null;
    phone: string | null;
    conekta_id: string | null;
    country: string | null;
    street: string | null;
    colonia: string | null;
    zip: string | null;
    city: string | null;
    state: string | null;
}

interface InventoryMongo {
    _id?: ObjectId;
    available: number;
    total: number;
    name: string;
    price: number;
}

interface ItemsByCartMongo {
    _id?: ObjectId;
    product_id: ObjectId,
    cart_id: ObjectId, 
    qty: number;
    price: number;
    name: string;
}

interface PurchasesMongo {
    _id?: ObjectId;
    product_id: ObjectId,
    qty: number;
    price: number;
    name: string;
    user_id: ObjectId | null;
    session_id: ObjectId;
    date: Date;
}

interface CartsByUserMongo {
    _id?: ObjectId;
    user_id: ObjectId;
    expireDate: Date | null;
}

interface ReservedInventoryMongo {
    _id?: ObjectId;
    cart_id: ObjectId;
    product_id: ObjectId;
    qty: number;
}

interface ContextLocals {
    users: Collection<UserMongo>;
    inventory: Collection<InventoryMongo>;
    itemsByCart: Collection<ItemsByCartMongo>;
    cartsByUser: Collection<CartsByUserMongo>;
    reservedInventory: Collection<ReservedInventoryMongo>;
    sessions: Collection<SessionMongo>
    purchases: Collection<PurchasesMongo>
}

interface UserJWT {
    _id: string;
    cart_id: string;
}

interface SessionCookie {
    _id: string;
    email: string | null;
    cart_id: string;
    name: string | null;
    apellidos: string | null;
    phone: string | null;
    conekta_id: string | null;
    default_address: string | null;
    addresses: AddressUserJWT[];
    phone_prefix: string | null;
}

export interface DecodeJWT {
    user: UserJWT;
    iat: number;
    exp: number;
    refreshTokenExpireTime: number;
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
            }
        }
    }
    if (!req.app.locals.id) {
        const payload = jwt.verify(refreshToken, REFRESHSECRET);
        if (payload) {
            const now = new Date();
            now.setMilliseconds(0);
            const accessTokenExpireTime = now.getTime() / 1000 + ACCESS_TOKEN_EXP_NUMBER;
            const newAccessToken = jwt.sign(
              {
                user: {
                    _id: payload.user._id,
                    cart_id: payload.user.cart_id
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
            state: null
        }
        res.cookie("session", JSON.stringify(session))
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
    const { inventory } = req.app.locals as ContextLocals
    const products = await inventory.find().toArray()
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    res.header("Pragma", "no-cache");
    res.header("Expires", "0");
    res.status(200).json(products)
});

app.post('/inventory', async (req, res) => {
    try {
        const qty = req.body.qty
        const name = req.body.name
        const price = req.body.price
        if (typeof qty !== "number") {
            throw new Error("Quantity is required and must be a number")
        }
        if (typeof price !== "number") {
            throw new Error("Price is required and must be a number")
        }
        if (typeof name !== "string") {
            throw new Error("Name is required and must be a string")
        }
        const { inventory } = req.app.locals as ContextLocals
        const inventoryResult = await inventory.insertOne({
            available: qty,
            total: qty,
            name,
            price,
        })
        fs.readFile('templates/product.html', 'utf8', async (err, html) => {
            if (err) throw err;
            const template = Handlebars.compile(html);
            const result = template({
                available: qty,
                total: qty,
                name,
                price: (price / 100).toFixed(2),
                buttonText: qty ? "Añadir al carrito" : "Agotado",
                buttonProps: qty ? "" : "disabled"
            });
            fs.writeFileSync(`static/product-${inventoryResult.insertedId}.html`, result)
        });
        res.status(200).json("OK!")
    } catch(e) {
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
        const name = req.body.name
        const price = req.body.price
        if (typeof id !== "string") {
            throw new Error("ID is required and must be a string")
        }
        if (id.length !== 24) {
            throw new Error("ID must contain 24 characters")
        }
        if (increment && typeof increment !== "number") {
            throw new Error("Increment must be a number")
        }
        if (price && typeof price !== "number") {
            throw new Error("Price and must be a number")
        }
        if (name && typeof name !== "string") {
            throw new Error("Name must be a string")
        }
        if (!(price || name || increment)) {
            throw new Error("At least one field is required")
        }
        const { inventory, itemsByCart } = req.app.locals as ContextLocals
        const product_oid = new ObjectId(id)
        const result = await inventory.findOneAndUpdate({
            _id: product_oid,
            available: {
                $gte: -increment
            }
        },
        {
            ...(increment ? {
                $inc: {
                    available: increment,
                    total: increment,
                }
            } : {}),
            ...((name || price) ? {
                $set: {
                    ...(name ? { name } : {}),
                    ...(price ? { price } : {})
                }
            } : {})
        },
        {
            returnDocument: "after",
        })
        const { value } = result
        if (!value) {
            throw new Error("Not enough inventory or product not found")
        }
        if (price) {
            await itemsByCart.updateMany({ product_id: product_oid }, { $set: { price } })
        }
        fs.readFile('templates/product.html', 'utf8', async (err, html) => {
            if (err) throw err;
            const template = Handlebars.compile(html);
            const templateResult = template({
                available: value.available,
                total: value.total,
                name: value.name,
                price: (value.price / 100).toFixed(2),
                buttonText: value.available ? "Añadir al carrito" : "Agotado",
                buttonProps: value.available ? "" : "disabled"
            });
            fs.writeFileSync(`static/product-${result.value?._id}.html`, templateResult)
        });
        res.status(200).json({
            product: result.value
        })
    } catch(e) {
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
                name: `${name} ${apellidos}` ,
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
          secure: NODE_ENV === "production" ? true : false,
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
    } catch(e) {
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
    } catch(e) {
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
            secure: NODE_ENV === "production" ? true : false,
        });
        res.setHeader("accessToken", accessToken)
        res.status(200).json({
            user: {
                ...user,
                password: undefined
            }
        })
    } catch(e) {
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
        const qty = req.body.qty
        if (product_id && typeof product_id !== "string") {
            throw new Error("Product ID is required and must be a string")
        }
        if (product_id.length !== 24) {
            throw new Error("Product ID must contain 24 characters")
        }
        if (qty && typeof qty !== "number") {
            throw new Error("Quantity is required and must be a number")
        }
        const cart_oid = new ObjectId(ctx?.userJWT?.user.cart_id || ctx?.sessionCookie?.cart_id)
        const product_oid = new ObjectId(product_id)
        const product = await inventory.findOneAndUpdate({
            _id: product_oid,
            available: {
                $gte: qty
            }
        },
        {
            $inc: {
                available: -qty
            }
        },
        {
            returnDocument: "after"
        })
        const { value } = product
        if (!value) {
            throw new Error("Not enough inventory or product not found")
        }
        fs.readFile('templates/product.html', 'utf8', async (err, html) => {
            if (err) throw err;
            const template = Handlebars.compile(html);
            const templateResult = template({
                available: value.available,
                total: value.total,
                name: value.name,
                price: (value.price / 100).toFixed(2),
                buttonText: value.available ? "Añadir al carrito" : "Agotado",
                buttonProps: value.available ? "" : "disabled"
            });
            fs.writeFileSync(`static/product-${value?._id}.html`, templateResult)
        });
        const expireDate = new Date()
        expireDate.setHours(expireDate.getHours() + 1)
        const reserved = await reservedInventory.updateOne({
            cart_id: cart_oid,
            product_id: product_oid,
        },
        {
            $inc: {
                qty,
            },
            $setOnInsert: {
                price: value.price,
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
                    qty
                },
                $setOnInsert: {
                    name: value.name,
                    product_id: product_oid,
                    cart_id: cart_oid,
                    price: value.price,
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
    } catch(e) {
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
        const qty = req.body.qty
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
        if (qty && typeof qty !== "number") {
            throw new Error("Quantity is required and must be a number")
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
        const product = await inventory.findOneAndUpdate({
            _id: product_oid,
            available: {
                $gte: qty - reserved.value.qty,
            }
        },
        {
            $inc: {
                available: reserved.value.qty - qty,
            },
        },
        {
            returnDocument: "after"
        })
        const { value } = product
        if (!value) {
            throw new Error("Not enough inventory or product not found")
        }
        fs.readFile('templates/product.html', 'utf8', async (err, html) => {
            if (err) throw err;
            const template = Handlebars.compile(html);
            const templateResult = template({
                available: value.available,
                total: value.total,
                name: value.name,
                price: (value.price / 100).toFixed(2),
                buttonText: value.available ? "Añadir al carrito" : "Agotado",
                buttonProps: value.available ? "" : "disabled"
            });
            fs.writeFileSync(`static/product-${value?._id}.html`, templateResult)
        });
        const item_by_cart_oid = new ObjectId(item_by_cart_id)
        const result = await itemsByCart.updateOne(
            {
                _id: item_by_cart_oid,
                cart_id: cart_oid,
            },
            {
                $set: {
                    qty,
                    price: value.price,
                    name: value.name,
                },
            },
        )
        if (!result.modifiedCount) {
            throw new Error("Item in cart not modified.")
        }
        const expireDate = new Date()
        expireDate.setHours(expireDate.getHours() + 1)
        const newReserved = await reservedInventory.insertOne(
        {
            qty,
            cart_id: cart_oid,
            product_id: product_oid,
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
    } catch(e) {
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
    } catch(e) {
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
                available: reservation.value.qty
            },
        })
        const { value } = product
        if (!value) {
            throw new Error("Inventory not modified.")
        }
        fs.readFile('templates/product.html', 'utf8', async (err, html) => {
            if (err) throw err;
            const template = Handlebars.compile(html);
            const templateResult = template({
                available: value.available,
                total: value.total,
                name: value.name,
                price: (value.price / 100).toFixed(2),
                buttonText: value.available ? "Añadir al carrito" : "Agotado",
                buttonProps: value.available ? "" : "disabled"
            });
            fs.writeFileSync(`static/product-${value?._id}.html`, templateResult)
        });
        res.status(200).json("Ok")
    } catch(e) {
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
        const { name, apellidos, street, email, country, colonia, zip, city, state, phone, address_id } = req.body
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
            const { password, ...user } = result.value
            const products = await itemsByCart.find({ cart_id: cart_oid }).toArray()
            const order = await orderClient.createOrder({
                currency: "MXN",
                customer_info: {
                    customer_id: result.value.conekta_id,
                },
                line_items: products.map(product => ({
                    name: product.name,
                    unit_price: product.price,
                    quantity: product.qty
                })),
                checkout: {
                    type: 'Integration',
                    allowed_payment_methods: ['card', 'cash', 'bank_transfer'],
                }
            })
            return res.status(200).json({
                user,
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
                    }
                },
            },
            {
                returnDocument: "after"
            })
            if (!result.value) {
                throw new Error("No user updated")
            }
            const { password, ...user } = result.value
            const products = await itemsByCart.find({ cart_id: cart_oid }).toArray()
            const order = await orderClient.createOrder({
                currency: "MXN",
                customer_info: {
                    customer_id: result.value.conekta_id,
                },
                line_items: products.map(product => ({
                    name: product.name,
                    unit_price: product.price,
                    quantity: product.qty
                })),
                checkout: {
                    type: 'Integration',
                    allowed_payment_methods: ['card', 'cash', 'bank_transfer'],
                }
            })
            return res.status(200).json({
                user,
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
                    unit_price: product.price,
                    quantity: product.qty
                })),
                checkout: {
                    type: 'Integration',
                    allowed_payment_methods: ['card', 'cash', 'bank_transfer'],
                }
            })
            result.value.conekta_id = conekta_id
            res.cookie("session", JSON.stringify(result.value))
            res.status(200).json({
                checkout_id: order?.data?.checkout?.id
            })
        }
    } catch(e) {
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
            const purchasedProducts = productsInCart.map(product => ({
                name: product.name,
                product_id: product._id,
                qty: product.qty,
                price: product.price,
                user_id: user_oid,
                session_id: session_oid,
                date: new Date(),
            }))
            await purchases.insertMany(purchasedProducts)
            return res.status(200).json({
                user
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
            const purchasedProducts = productsInCart.map(product => ({
                name: product.name,
                product_id: product._id,
                qty: product.qty,
                price: product.price,
                user_id: null,
                session_id: session_oid,
                date: new Date(),
            }))
            await purchases.insertMany(purchasedProducts)
            if (session.value) {
                res.cookie("session", JSON.stringify(session.value))
            }
            return res.status(200).json({
                user: null,
            })
        }
    } catch(e) {
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
    } catch(e) {
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
        if (req.path.includes(".js")) {
            const template = fs.readFileSync(`static/${req.path}`, 'utf-8');
            return res.status(200).set({ 'Content-Type': 'application/javascript' }).end(template);
        }
        if (req.path.includes(".css")) {
            const template = fs.readFileSync(`static/${req.path}`, 'utf-8');
            return res.status(200).set({ 'Content-Type': 'text/css' }).end(template);
        }
        const template = fs.readFileSync(`static/${req.path}.html`, 'utf-8');
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch {
        res.status(400).json({ message: "Error" })
    }
});

//Define site pages
//Update pages on demand
//Promotions?
//Cron job or mongo tasks?
//Estilos

MongoClient.connect(MONGO_DB, {}).then(async (client) => {
    const db = client.db("fourb");
    fs.readFile('templates/product.html', 'utf8', async (err, html) => {
        if (err) throw err;
        const products = await db.collection("inventory").find().toArray()
        products.forEach(item => {
            const template = Handlebars.compile(html);
            const result = template({
                ...item,
                price: (item.price / 100).toFixed(2),
                buttonText: item.available ? "Añadir al carrito" : "Agotado",
                buttonProps: item.available ? "" : "disabled"
            });
            fs.writeFileSync(`static/product-${item._id}.html`, result)
        })
    });
    fs.readFile('templates/history.html', 'utf8', async (err, html) => {
        if (err) throw err;
        fs.writeFileSync(`static/history.html`, html)
    });
    fs.readFile('templates/inventory-admin.html', 'utf8', async (err, html) => {
        if (err) throw err;
        fs.writeFileSync(`static/inventory-admin.html`, html)
    });
    fs.readFile('templates/main.html', 'utf8', async (err, html) => {
        if (err) throw err;
        fs.writeFileSync(`static/main.html`, html)
    });
    fs.readFile('templates/cart.html', 'utf8', async (err, html) => {
        if (err) throw err;
        fs.writeFileSync(`static/cart.html`, html)
    });
    fs.readFile('templates/checkout.html', 'utf8', async (err, html) => {
        if (err) throw err;
        fs.writeFileSync(`static/checkout.html`, html)
    });
    fs.readFile('templates/payment.html', 'utf8', async (err, html) => {
        if (err) throw err;
        fs.writeFileSync(`static/payment.html`, html)
    });
    fs.readFile('templates/account.html', 'utf8', async (err, html) => {
        if (err) throw err;
        fs.writeFileSync(`static/account.html`, html)
    });
    fs.readFile('templates/main.js', 'utf8', async (err, html) => {
        if (err) throw err;
        fs.writeFileSync(`static/main.js`, html)
    });
    fs.readFile('templates/main.css', 'utf8', async (err, html) => {
        if (err) throw err;
        fs.writeFileSync(`static/main.css`, html)
    });
    app.locals.users = db.collection("users")
    app.locals.cartsByUser = db.collection("carts_by_user")
    app.locals.inventory = db.collection("inventory")
    app.locals.itemsByCart = db.collection("items_by_cart")
    app.locals.reservedInventory = db.collection("reserved_inventory")
    app.locals.sessions = db.collection("sessions")
    app.locals.purchases = db.collection("purchases")
    app.listen(8000)
})


