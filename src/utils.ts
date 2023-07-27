import fs from 'fs';
import { VIRTUAL_HOST } from "./config";
import Handlebars from 'handlebars';
import { Db } from 'mongodb';
import { InventoryMongo } from '.';

export const createHTML = (db: Db) => {
    fs.readFile('templates/product.html', 'utf8', async (err, html) => {
        if (err) throw err;
        const products = await db.collection<InventoryMongo>("inventory").find().toArray()
        products.forEach(item => {
            const template = Handlebars.compile(html);
            const result = template({
                ...item,
                _id: item._id.toHexString(),
                price: `$${(item.price / 100).toFixed(2)}`,
                discountPrice: item.use_discount ? `$${(item.discount_price / 100).toFixed(2)}` : "",
                buttonText: item.available ? "Añadir al carrito" : "Agotado",
                buttonProps: item.available ? "" : "disabled",
                domain: VIRTUAL_HOST,
                img: item.img,
                priceClass: item.use_discount ? "price-discounted" : "",
                discontPriceClass: item.use_discount ? "" : "",
            });
            fs.writeFileSync(`static/product-${item._id}.html`, result)
        })
    });
    fs.readFile('templates/history.html', 'utf8', async (err, html) => {
        if (err) throw err;
        const template = Handlebars.compile(html);
        const result = template({
            domain: VIRTUAL_HOST,
        });
        fs.writeFileSync(`static/history.html`, result)
    });
    fs.readFile('templates/inventory-admin.html', 'utf8', async (err, html) => {
        if (err) throw err;
        const template = Handlebars.compile(html);
        const result = template({
            domain: VIRTUAL_HOST,
        });
        fs.writeFileSync(`static/inventory-admin.html`, result)
    });
    fs.readFile('templates/main.html', 'utf8', async (err, html) => {
        if (err) throw err;
        const template = Handlebars.compile(html);
        const result = template({
            domain: VIRTUAL_HOST,
        });
        fs.writeFileSync(`static/main.html`, result)
    });
    fs.readFile('templates/cart.html', 'utf8', async (err, html) => {
        if (err) throw err;
        const template = Handlebars.compile(html);
        const result = template({
            domain: VIRTUAL_HOST,
        });
        fs.writeFileSync(`static/cart.html`, result)
    });
    fs.readFile('templates/checkout.html', 'utf8', async (err, html) => {
        if (err) throw err;
        const template = Handlebars.compile(html);
        const result = template({
            domain: VIRTUAL_HOST,
        });
        fs.writeFileSync(`static/checkout.html`, result)
    });
    fs.readFile('templates/payment.html', 'utf8', async (err, html) => {
        if (err) throw err;
        const template = Handlebars.compile(html);
        const result = template({
            domain: VIRTUAL_HOST,
        });
        fs.writeFileSync(`static/payment.html`, result)
    });
    fs.readFile('templates/account.html', 'utf8', async (err, html) => {
        if (err) throw err;
        const template = Handlebars.compile(html);
        const result = template({
            domain: VIRTUAL_HOST,
        });
        fs.writeFileSync(`static/account.html`, result)
    });
    fs.readFile('templates/main.js', 'utf8', async (err, html) => {
        if (err) throw err;
        const template = Handlebars.compile(html);
        const result = template({
            domain: VIRTUAL_HOST,
        });
        fs.writeFileSync(`static/main.js`, result)
    });
    fs.readFile('templates/main.css', 'utf8', async (err, html) => {
        if (err) throw err;
        fs.writeFileSync(`static/main.css`, html)
    });
    fs.copyFile('templates/favicon.ico', 'static/favicon.ico', async (err) => {
        if (err) throw err;
    });
    fs.copyFile('templates/fourb.png', 'static/fourb.png', function (err) {
        if (err) throw err
    });
}