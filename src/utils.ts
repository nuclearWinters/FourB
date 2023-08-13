import fs from 'fs';
import { VIRTUAL_HOST } from "./config";
import Handlebars from 'handlebars';
import { Db } from 'mongodb';
import { InventoryMongo } from './types';

export const createHTML = async (db: Db) => {
    const productsHtml = fs.readFileSync('templates/product.html', 'utf8');
    const products = await db.collection<InventoryMongo>("inventory").find().toArray()
    products.forEach(item => {
        const template = Handlebars.compile(productsHtml);
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
    const historyHtml = fs.readFileSync('templates/history.html', 'utf8');
    const template1 = Handlebars.compile(historyHtml);
    const result1 = template1({
        domain: VIRTUAL_HOST,
    });
    fs.writeFileSync(`static/history.html`, result1)
    const adminHtml = fs.readFileSync('templates/inventory-admin.html', 'utf8');
    const template2 = Handlebars.compile(adminHtml);
    const result2 = template2({
        domain: VIRTUAL_HOST,
    });
    fs.writeFileSync(`static/inventory-admin.html`, result2)
    const mainHtml = fs.readFileSync('templates/main.html', 'utf8');
    const template3 = Handlebars.compile(mainHtml);
    const result3 = template3({
        domain: VIRTUAL_HOST,
    });
    fs.writeFileSync(`static/main.html`, result3)
    const searchHtml = fs.readFileSync('templates/search.html', 'utf8');
    const template4 = Handlebars.compile(searchHtml);
    const result4 = template4({
        domain: VIRTUAL_HOST,
    });
    fs.writeFileSync(`static/search.html`, result4)
    const cartHtml = fs.readFileSync('templates/cart.html', 'utf8');
    const template5 = Handlebars.compile(cartHtml);
    const result5 = template5({
        domain: VIRTUAL_HOST,
    });
    fs.writeFileSync(`static/cart.html`, result5)
    const checkoutHtml = fs.readFileSync('templates/checkout.html', 'utf8');
    const template6 = Handlebars.compile(checkoutHtml);
    const result6 = template6({
        domain: VIRTUAL_HOST,
    });
    fs.writeFileSync(`static/checkout.html`, result6)
    const htmlPayment = fs.readFileSync('templates/payment.html', 'utf8');
    const template = Handlebars.compile(htmlPayment);
    const result = template({
        domain: VIRTUAL_HOST,
    });
    fs.writeFileSync(`static/payment.html`, result)
    const htmlAccount = fs.readFileSync('templates/account.html', 'utf8');
    const template7 = Handlebars.compile(htmlAccount);
    const result7 = template7({
        domain: VIRTUAL_HOST,
    });
    fs.writeFileSync(`static/account.html`, result7)
    const jsMain = fs.readFileSync('templates/main.js', 'utf8');
    const template8 = Handlebars.compile(jsMain);
    const result8 = template8({
        domain: VIRTUAL_HOST,
    });
    fs.writeFileSync(`static/main.js`, result8)
    const css = fs.readFileSync('templates/main.css', 'utf8');
    fs.writeFileSync(`static/main.css`, css)
    fs.copyFileSync('templates/favicon.ico', 'static/favicon.ico');
    fs.copyFileSync('templates/fourb.png', 'static/fourb.png');
    fs.copyFileSync('templates/banner.webp', 'static/banner.webp');
}

export const generateProductHTML = (value: InventoryMongo) => {
    const productHTML = fs.readFileSync('templates/product.html', 'utf8');
    const template = Handlebars.compile(productHTML);
    const templateResult = template({
        available: value.available,
        total: value.total,
        name: value.name,
        price: `$${(value.price / 100).toFixed(2)}`,
        discountPrice: value.use_discount ? `$${(value.discount_price / 100).toFixed(2)}` : "",
        buttonText: value.available ? "Añadir al carrito" : "Agotado",
        buttonProps: value.available ? "" : "disabled",
        domain: VIRTUAL_HOST,
        img: value.img,
        priceClass: value.use_discount ? "price-discounted" : "",
        discontPriceClass: value.use_discount ? "" : "",
        code: value.code,
    });
    fs.writeFileSync(`static/product-${value?._id}.html`, templateResult)
}