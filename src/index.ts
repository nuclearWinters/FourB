import fs from 'fs';
import express from 'express'
import { Collection, MongoClient, ObjectId } from "mongodb";
import { MONGO_DB } from "./config";
import Handlebars from 'handlebars';
import bcrypt from "bcryptjs"
import jsonwebtoken, { SignOptions } from "jsonwebtoken"
import cookieParser from "cookie-parser"
import { CustomersApi, Configuration, OrdersApi } from 'conekta';

const apikey = "key_pMkl11iWacZYSvetll0CaMc";
const config = new Configuration({ accessToken: apikey });
const customerClient = new CustomersApi(config);
const orderClient = new OrdersApi(config);

export const REFRESH_TOKEN_EXP_NUMBER = 900;
export const ACCESS_TOKEN_EXP_NUMBER = 180;
export const REFRESHSECRET = process.env.REFRESHSECRET || "REFRESHSECRET";
export const ACCESSSECRET = process.env.ACCESSSECRET || "ACCESSSECRET";
export const NODE_ENV = process.env.NODE_ENV || "development";

/*
Guardar usuario sin o con contraseña
Mandar email para generar contraseña
Guardar direcciones
*/

interface UserMongo {
    _id?: ObjectId;
    email: string;
    password: string;
    cart_id: ObjectId;
    name: string;
    apellido_paterno: string;
    apellido_materno: string;
    phone: string;
    conekta_id: string;
    default_address: ObjectId | null;
    addresses: {
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
        apellidoMaterno: string;
        apellidoPaterno: string;
    }[]
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

interface Context {
    id?: string;
    cart_id?: string;
    users: Collection<UserMongo>;
    inventory: Collection<InventoryMongo>;
    itemsByCart: Collection<ItemsByCartMongo>;
    cartsByUser: Collection<CartsByUserMongo>;
    reservedInventory: Collection<ReservedInventoryMongo>;
}

export interface DecodeJWT {
    _id: string;
    cart_id: string;
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
            const decoded = jsonwebtoken.verify(token, password);
            if (typeof decoded === "string") {
              throw new Error("payload is string")
            }
            return decoded as DecodeJWT;
        } catch {
            return null
        }
    },
    sign: (
      data: {
        _id: string;
        cart_id: string;
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
    const refreshToken = req.cookies.refreshToken
    if (!refreshToken) {
        return next()
    }
    const authorization = req.headers.authorization
    if (authorization) {
        const user = jwt.verify(authorization, ACCESSSECRET)
        if (user && typeof user !== "string") {
            req.app.locals.id = user._id
            req.app.locals.cart_id = user.cart_id
        }
    }
    if (!req.app.locals.id) {
        const user = jwt.verify(refreshToken, REFRESHSECRET);
        if (user) {
            const now = new Date();
            now.setMilliseconds(0);
            const accessTokenExpireTime = now.getTime() / 1000 + ACCESS_TOKEN_EXP_NUMBER;
            const newAccessToken = jwt.sign(
              {
                _id: user._id,
                cart_id: user.cart_id,
                refreshTokenExpireTime: user.exp,
                exp: accessTokenExpireTime > user.exp ? user.exp : accessTokenExpireTime,
              },
              ACCESSSECRET
            );
            res.setHeader("accessToken", newAccessToken)
            req.app.locals.id = user._id
            req.app.locals.cart_id = user.cart_id
        }
    }
    next()
  })

app.get('/inventory', async (req, res) => {
    const { inventory } = req.app.locals as Context
    const products = await inventory.find().toArray()
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
        const { inventory } = req.app.locals as Context
        await inventory.insertOne({
            available: qty,
            total: qty,
            name,
            price,
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

app.patch('/inventory', async (req, res) => {
    try {
        const id = req.body.id
        const increment = req.body.increment
        const name = req.body.name
        const price = req.body.price
        if (typeof id !== "string") {
            throw new Error("ID is required and must be a string")
        }
        if (id.length !== 24) {
            throw new Error("ID must contain 24 characters")
        }
        if (increment && typeof increment !== "number") {
            throw new Error("Increment is required and must be a number")
        }
        if (price && typeof price !== "number") {
            throw new Error("Price is required and must be a number")
        }
        if (name && typeof name !== "string") {
            throw new Error("Increment is required and must be a number")
        }
        if (!(price || name || increment)) {
            throw new Error("At least one field is required")
        }
        const { inventory, itemsByCart } = req.app.locals as Context
        const result = await inventory.updateOne({ _id: new ObjectId(id), qty: { $gte: -increment } },{
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
        })
        if (!result.modifiedCount) {
            throw new Error("Not enough inventory or product not found")
        }
        if (price) {
            await itemsByCart.updateMany({ product_id: new ObjectId(id) }, { price })
        }
        res.status(200).json("OK!")
    } catch(e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
});

app.get('/user', async (req, res) => {
    try {
        const { id } = req.app.locals as Context
        if (typeof id !== "string") {
            throw new Error("ID is required and must be a string")
        }
        if (id.length !== 24) {
            throw new Error("ID must contain 24 characters")
        }
        const { users } = req.app.locals as Context
        const user = await users.findOne({ _id: new ObjectId(id) })
        if (!user) {
            throw new Error("No user found")
        }
        res.status(200).json({
            _id: user._id,
            cart_id: user.cart_id
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
        const name = req.body.name
        const apellidoPaterno = req.body.apellidoPaterno
        const apellidoMaterno = req.body.apellidoMaterno
        const phone = req.body.phone
        if (typeof email !== "string") {
            throw new Error("Email is required and must be a string")
        }
        if (typeof password !== "string") {
            throw new Error("Password is required and must be a string")
        }
        if (password.length < 8) {
            throw new Error("Password must have at least 8 characters")
        }
        if (typeof name !== "string") {
            throw new Error("Password is required and must be a string")
        }
        if (typeof apellidoPaterno !== "string") {
            throw new Error("Password is required and must be a string")
        }
        if (typeof apellidoMaterno !== "string") {
            throw new Error("Password is required and must be a string")
        }
        if (typeof phone !== "string") {
            throw new Error("Password is required and must be a string")
        }
        const { users, cartsByUser } = req.app.locals as Context
        const cart_id = new ObjectId();
        const user_id = new ObjectId();
        const user = await users.findOne({ email });
        if (user) throw new Error("El email ya esta siendo usado.");
        const hash_password = await bcrypt.hash(password, 12);
        const now = new Date();
        now.setMilliseconds(0);
        const nowTime = now.getTime() / 1000;
        const refreshTokenExpireTime = nowTime + REFRESH_TOKEN_EXP_NUMBER;
        const accessTokenExpireTime = nowTime + ACCESS_TOKEN_EXP_NUMBER;
        const refreshToken = jwt.sign(
          {
            _id: user_id.toHexString(),
            cart_id: cart_id.toHexString(),
            refreshTokenExpireTime: refreshTokenExpireTime,
            exp: refreshTokenExpireTime,
          },
          REFRESHSECRET
        );
        const accessToken = jwt.sign(
          {
            _id: user_id.toHexString(),
            cart_id: cart_id.toHexString(),
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
        const customer = await customerClient.createCustomer({
            name: `${name} ${apellidoMaterno} ${apellidoPaterno}` ,
            email,
            phone,
        });
        await users.insertOne({
            _id: user_id,
            email,
            password: hash_password,
            cart_id,
            name,
            apellido_materno: apellidoMaterno,
            apellido_paterno: apellidoPaterno,
            conekta_id: customer.data.id,
            phone,
            default_address: null,
            addresses: [],
        })
        await cartsByUser.insertOne({
            _id: cart_id,
            user_id,
            expireDate: null
        })
        res.setHeader("accessToken", accessToken)
        res.status(200).json({
            _id: user_id,
            cart_id,
        })
    } catch(e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
});

app.post('/log-in', async (req, res) => {
    try {
        const email = req.body.email
        const password = req.body.password
        if (typeof email !== "string") {
            throw new Error("Email is required and must be a string")
        }
        if (typeof password !== "string") {
            throw new Error("Password is required and must be a string")
        }
        if (password.length < 8) {
            throw new Error("Password must have at least 8 characters")
        }
        const { users } = req.app.locals as Context
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
            _id: user._id.toHexString(),
            cart_id: user.cart_id.toHexString(),
            refreshTokenExpireTime: refreshTokenExpireTime,
            exp: refreshTokenExpireTime,
          },
          REFRESHSECRET
        );
        const accessToken = jwt.sign(
          {
            _id: user._id.toHexString(),
            cart_id: user.cart_id.toHexString(),
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
            _id: user._id,
            cart_id: user.cart_id
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
        const product_id = req.body.product_id
        const qty = req.body.qty
        if (typeof product_id !== "string") {
            throw new Error("Product ID is required and must be a string")
        }
        if (product_id.length !== 24) {
            throw new Error("Product ID must contain 24 characters")
        }
        if (typeof qty !== "number") {
            throw new Error("Quantity is required and must be a number")
        }
        const { inventory, itemsByCart, cart_id, reservedInventory, cartsByUser } = req.app.locals as Context
        if (typeof cart_id !== "string") {
            throw new Error("Cart ID is required and must be a string")
        }
        if (cart_id.length !== 24) {
            throw new Error("Cart ID must contain 24 characters")
        }
        const product = await inventory.findOneAndUpdate({
            _id: new ObjectId(product_id),
            available: {
                $gte: qty
            }
        },
        {
            $inc: {
                available: -qty
            }
        })
        if (!product.value) {
            throw new Error("Not enough inventory or product not found")
        }
        const expireDate = new Date()
        expireDate.setHours(expireDate.getHours() + 1)
        const reserved = await reservedInventory.updateOne({
            cart_id: new ObjectId(cart_id),
            product_id: new ObjectId(product_id),
        },
        {
            $inc: {
                qty,
            },
            $setOnInsert: {
                qty,
                price: product.value.price,
                cart_id: new ObjectId(cart_id),
                product_id: new ObjectId(product_id),
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
                product_id: new ObjectId(product_id),
                cart_id: new ObjectId(cart_id),
            },
            {
                $inc: {
                    qty
                },
                $setOnInsert: {
                    name: product.value.name,
                    product_id: new ObjectId(product_id),
                    cart_id: new ObjectId(cart_id),
                    price: product.value.price,
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
            _id: new ObjectId(cart_id),
        },
        {
            expireDate
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
        const item_by_cart_id = req.body.item_by_cart_id
        const product_id = req.body.product_id
        const qty = req.body.qty
        if (typeof product_id !== "string") {
            throw new Error("Product ID is required and must be a string")
        }
        if (product_id.length !== 24) {
            throw new Error("Product ID must contain 24 characters")
        }
        if (typeof item_by_cart_id !== "string") {
            throw new Error("Product cart ID is required and must be a string")
        }
        if (item_by_cart_id.length !== 24) {
            throw new Error("Product cart ID must contain 24 characters")
        }
        if (typeof qty !== "number") {
            throw new Error("Quantity is required and must be a number")
        }
        const { inventory, itemsByCart, cart_id, reservedInventory, cartsByUser } = req.app.locals as Context
        if (typeof cart_id !== "string") {
            throw new Error("Product ID is required and must be a string")
        }
        if (cart_id.length !== 24) {
            throw new Error("Product ID must contain 24 characters")
        }
        const reserved = await reservedInventory.findOneAndDelete({
            cart_id: new ObjectId(cart_id),
            product_id: new ObjectId(product_id),
        })
        if (!reserved.value) {
            throw new Error("Item not reserved.")
        }
        const product = await inventory.findOneAndUpdate({
            _id: new ObjectId(product_id),
            available: {
                $gte: qty - reserved.value.qty 
            }
        },
        {
            $inc: {
                available: reserved.value.qty - qty
            },
        })
        if (!product.value) {
            throw new Error("Not enough inventory or product not found")
        }
        const result = await itemsByCart.updateOne(
            {
                _id: new ObjectId(item_by_cart_id),
                cart_id: new ObjectId(cart_id)
            },
            {
                $set: {
                    qty,
                    price: product.value.price,
                    name: product.value.name,
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
            cart_id: new ObjectId(cart_id),
            product_id: new ObjectId(product_id),
        })
        if (!newReserved.insertedId) {
            throw new Error("Item not reserved.")
        }
        await cartsByUser.updateOne({
            _id: new ObjectId(cart_id),
        },
        {
            expireDate
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
        const { itemsByCart, cart_id } = req.app.locals as Context
        if (typeof cart_id !== "string") {
            throw new Error("Cart ID is required and must be a string")
        }
        if (cart_id.length !== 24) {
            throw new Error("Cart ID must contain 24 characters")
        }
        const itemsInCart = await itemsByCart.find({ cart_id: new ObjectId(cart_id) }).toArray()
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
        const item_by_cart_id = req.body.item_by_cart_id   
        const { itemsByCart, cart_id, reservedInventory, inventory } = req.app.locals as Context
        if (typeof cart_id !== "string") {
            throw new Error("Product ID is required and must be a string")
        }
        if (cart_id.length !== 24) {
            throw new Error("Product ID must contain 24 characters")
        }
        if (typeof item_by_cart_id !== "string") {
            throw new Error("Product ID is required and must be a string")
        }
        if (item_by_cart_id.length !== 24) {
            throw new Error("Product ID must contain 24 characters")
        }
        const result = await itemsByCart.findOneAndDelete(
            {
                _id: new ObjectId(item_by_cart_id),
                cart_id: new ObjectId(cart_id)
            },
        )
        if (!result.value) {
            throw new Error("Item in cart was not deleted.")
        }
        const reservation = await reservedInventory.findOneAndDelete(
        {
            product_id: result.value.product_id,
            cart_id: new ObjectId(cart_id)
        })
        if (!reservation.value) {
            throw new Error("Item in reservation was not deleted.")
        }
        const product = await inventory.updateOne({
            _id: result.value.product_id,
        },
        {
            $inc: {
                available: reservation.value.qty
            },
        })
        if (!product.modifiedCount) {
            throw new Error("Inventory not modified.")
        }
        res.status(200).json("Ok")
    } catch(e) {
        if (e instanceof Error) {
            res.status(400).json(e.message)
        } else {
            res.status(400).json("Error")
        }
    }
})

/*
Pagina de carrito (puede modificar el carrito)
Pagina de checkout (confirma datos de envio y se genera la orden al terminar)
Pagina de pago (se usa la orden generada para realizar el pago en efectivo, transferencia o tarjeta
Pagina de confirmacion
*/

app.post('/checkout', async (req, res) => {
    const { conekta_id } = req.body
    const { itemsByCart, cart_id } = req.app.locals as Context
    if (typeof cart_id !== "string") {
        throw new Error("ID is required and must be a string")
    }
    if (cart_id.length !== 24) {
        throw new Error("ID must contain 24 characters")
    }
    if (typeof cart_id !== "string") {
        throw new Error("ID is required and must be a string")
    }
    const products = await itemsByCart.find({ cart_id: new ObjectId(cart_id) }).toArray()
    const order = await orderClient.createOrder({
        currency: "MXN",
        customer_info: {
            customer_id: 'cus_2neG7CYEdeda9BBGU'
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
    res.status(200).json({
        products
    })
});

app.post('/checkout', async (req, res) => {

})

app.get('*', async (req, res) => {
    try {
        const template = fs.readFileSync(`static/${req.path}.html`, 'utf-8');
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch {
        res.status(400).json({ message: "Error" })
    }
});

//Define site pages
//Main
//Account
//Cart
//Product
//Checkout
//Payment
//Confirmation
//Historial

MongoClient.connect(MONGO_DB, {}).then(async (client) => {
    const db = client.db("fourb");
    fs.readFile('templates/product.html', 'utf8', async (err, product) => {
        if (err) throw err;
        const products = await db.collection("inventory").find().toArray()
        products.forEach(item => {
            const template = Handlebars.compile(product);
            const result = template(item);
            fs.writeFileSync(`static/product-${item._id}.html`, result)
        })
    });
    app.locals.users = db.collection("users")
    app.locals.cartsByUser = db.collection("carts_by_user")
    app.locals.inventory = db.collection("inventory")
    app.locals.itemsByCart = db.collection("items_by_cart")
    app.locals.reservedInventory = db.collection("reserved_inventory")
    app.listen(8000)
})


