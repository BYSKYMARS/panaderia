const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express');
const cors = require('cors');
const path = require('path');

const MP_ACCESS_TOKEN = 'APP_USR-4542639169967656-070613-4c1a9f7fb3e95820a7b9616bbe126d5f-3523271794'; 
const PUERTO_WEB = 3000; 

let inventory = [
    { id: 1, name: 'Pan Francés', price: 0.50, stock: 45, img: 'https://images.unsplash.com/photo-1597079910443-60c43fc4f729?auto=format&fit=crop&w=400&q=80', desc: 'Clásico pan crocante.' },
    { id: 2, name: 'Pan Ciabatta', price: 0.80, stock: 12, img: 'https://images.unsplash.com/photo-1619535860434-ba1d8fa12536?auto=format&fit=crop&w=400&q=80', desc: 'Ideal para sándwiches.' },
    { id: 3, name: 'Pan Integral', price: 1.20, stock: 8, img: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=400&q=80', desc: 'Con semillas y fibra.' },
    { id: 4, name: 'Croissant', price: 3.00, stock: 5, img: 'https://images.unsplash.com/photo-1555507036-ab1f40ce88cb?auto=format&fit=crop&w=400&q=80', desc: 'Hojaldre suave.' }
];

let orders = [];
let sesiones = {};
const app = express();
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/')));

// Función dedicada que no rompe el servidor si el bot no está listo
async function enviarNotificacionWhatsApp(customer, cart) {
    if (!customer || !customer.phone) return;
    
    try {
        // Formatear el teléfono automáticamente (Ej: 987654321 -> 51987654321)
        let telefono = customer.phone.replace(/\s+/g, '');
        if (!telefono.startsWith('51') && telefono.length === 9) telefono = '51' + telefono;
        
        const chatId = telefono + "@c.us"; 
        const message = `¡Hola ${customer.name || 'cliente'}! Gracias por tu compra en La Masa de Oro. 🥖\n\nResumen:\n${cart.map(i => `- ${i.name} (x${i.qty})`).join('\n')}\n\nHora de recojo: ${customer.time}`;
        
        await client.sendMessage(chatId, message);
        console.log("✅ Mensaje de WhatsApp enviado exitosamente a:", telefono);
    } catch (wsError) {
        console.error("⚠️ No se pudo enviar WhatsApp (El bot podría no estar escaneado):", wsError.message);
    }
}

app.get('/api/products', (req, res) => res.json(inventory));
app.get('/api/orders', (req, res) => res.json(orders));

// RUTA 1: Para pago simulado con Tarjeta (Activa WhatsApp al instante)
app.post('/api/orders', async (req, res) => {
    const { cart, customer } = req.body;
    
    // Registrar orden
    const newOrder = { id: Math.random().toString(36).substring(2, 7).toUpperCase(), cart, customer };
    orders.push(newOrder);

    // Enviar WhatsApp sin depender de Mercado Pago
    await enviarNotificacionWhatsApp(customer, cart);
    
    res.status(201).json({ message: "Orden creada con éxito", order: newOrder });
});

// RUTA 2: Para generar link oficial de Mercado Pago
app.post('/api/create_preference', async (req, res) => {
    try {
        const { cart, customer } = req.body;
        if (!cart || cart.length === 0) return res.status(400).json({ error: "El carrito está vacío" });

        const items = cart.map(item => ({
            title: String(item.name),
            unit_price: Number(item.price),
            quantity: Number(item.qty),
            currency_id: 'PEN'
        }));

        const preference = {
            items: items,
            back_urls: {
                success: "http://localhost:3000/panel_cliente.html",
                failure: "http://localhost:3000/checkout.html",
                pending: "http://localhost:3000/panel_cliente.html"
            },
            auto_return: "approved"
        };

        const response = await axios.post(
            'https://api.mercadopago.com/checkout/preferences',
            preference,
            { headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
        );

        // Disparamos el WhatsApp también aquí
        await enviarNotificacionWhatsApp(customer, cart);

        res.json({ id: response.data.id });

    } catch (error) {
        console.error("Error al conectar con Mercado Pago:", error.message);
        res.status(500).json({ error: "Error en el pago con Mercado Pago" });
    }
});

const client = new Client({ 
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu']
    }
});

client.on('qr', (qr) => {
    console.log('\n=========================================');
    console.log('ESCANEA ESTE QR PARA CONECTAR EL BOT:');
    qrcode.generate(qr, { small: true });
    console.log('=========================================\n');
});

client.on('ready', () => {
    console.log('✅ Bot de WhatsApp conectado y listo.');
    console.log(`🌐 Tienda Web corriendo en: http://localhost:${PUERTO_WEB}`);
});

client.on('message', async (msg) => {
    console.log("¡Bot recibió un mensaje! Contenido:", msg.body);
    const from = msg.from;
    const texto = msg.body.toLowerCase();

    if (!sesiones[from]) sesiones[from] = { paso: 'INICIO' };
    const estado = sesiones[from].paso;

    if (texto.includes('hola') || texto.includes('menu')) {
        sesiones[from].paso = 'ELIGIENDO_PRODUCTO';
        let menu = `🥐 *La Masa de Oro - Menú*\n\n`;
        inventory.forEach(p => menu += `${p.id}. ${p.name} - S/ ${p.price.toFixed(2)} ${p.stock > 0 ? '' : '(AGOTADO)'}\n`);
        return await msg.reply(menu + `\nEscribe el número del pan.`);
    }

    if (estado === 'ELIGIENDO_PRODUCTO') {
        const p = inventory.find(i => i.id === parseInt(texto));
        if (!p) return msg.reply('Número inválido.');
        sesiones[from].idProducto = p.id;
        sesiones[from].paso = 'ELIGIENDO_CANTIDAD';
        return await msg.reply(`Elegiste ${p.name}. ¿Qué cantidad?`);
    }

    if (estado === 'ELIGIENDO_CANTIDAD') {
        sesiones[from].cantidad = parseInt(texto);
        sesiones[from].paso = 'ESPERANDO_NOMBRE';
        return await msg.reply(`¿A qué nombre registramos el pedido?`);
    }

    if (estado === 'ESPERANDO_NOMBRE') {
        sesiones[from].nombre = msg.body;
        sesiones[from].paso = 'ESPERANDO_HORA';
        return await msg.reply(`¿A qué hora pasas a recogerlo?`);
    }

    if (estado === 'ESPERANDO_HORA') {
        const datos = sesiones[from];
        const p = inventory.find(i => i.id === datos.idProducto);
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        p.stock -= datos.cantidad;
        await msg.reply(`✅ *Pedido registrado!*\nCódigo: ${code}\nTotal: S/ ${(p.price * datos.cantidad).toFixed(2)}\nRecojo: ${msg.body}`);
        delete sesiones[from];
    }
});

client.initialize();
app.listen(PUERTO_WEB, () => {});