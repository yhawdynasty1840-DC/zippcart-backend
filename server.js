const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: __dirname + '/.env' });

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://zippcart_admin:44fLoMRA8awIZNST@ac-dixdnuf-shard-00-00.mbht8ka.mongodb.net:27017,ac-dixdnuf-shard-00-01.mbht8ka.mongodb.net:27017,ac-dixdnuf-shard-00-02.mbht8ka.mongodb.net:27017/zippcart?ssl=true&authSource=admin';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.log('❌ MongoDB Error:', err.message));

const userSchema = new mongoose.Schema({
    name: String, email: { type: String, unique: true }, password: String,
    role: { type: String, default: 'customer' }, status: { type: String, default: 'active' },
    businessName: String, businessType: String, phone: String, products: String,
    monthlySales: String, createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const visitorSchema = new mongoose.Schema({
    page: String, action: String, userId: String, timestamp: { type: Date, default: Date.now }
});
const Visitor = mongoose.model('Visitor', visitorSchema);

const orderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    items: Array, total: Number, paymentMethod: String,
    status: { type: String, default: 'pending' },
    customerInfo: Object, orderNumber: String, createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

app.get('/', (req, res) => { res.json({ message: 'Welcome to Zippcart API' }); });

app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const exists = await User.findOne({ email });
        if (exists) return res.status(400).json({ message: 'Email already registered' });
        const hp = await bcrypt.hash(password, 10);
        const user = await User.create({ name, email, password: hp, role: 'customer' });
        const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'zippcart_secret_key_2024', { expiresIn: '7d' });
        res.status(201).json({ message: 'Account created', token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid email or password' });
        if (user.role === 'seller' && user.status === 'pending') return res.status(403).json({ message: 'Account pending approval' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: 'Invalid email or password' });
        const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'zippcart_secret_key_2024', { expiresIn: '7d' });
        res.json({ message: 'Login successful', token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/seller/register', async (req, res) => {
    try {
        const { businessName, businessType, contactPerson, phone, email, products, monthlySales } = req.body;
        const exists = await User.findOne({ email });
        if (exists) return res.status(400).json({ message: 'Email already registered' });
        await User.create({ name: contactPerson, email, phone, password: await bcrypt.hash('temp123', 10), role: 'seller', status: 'pending', businessName, businessType, products, monthlySales });
        res.status(201).json({ message: 'Application submitted! Awaiting admin approval.' });
    } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { items, total, paymentMethod, customerInfo } = req.body;
        const token = req.headers.authorization?.split(' ')[1];
        let userId = null;
        if (token) { const d = jwt.verify(token, process.env.JWT_SECRET || 'zippcart_secret_key_2024'); userId = d.id; }
        const on = 'ZIP-' + Date.now().toString().slice(-8);
        await Order.create({ userId, items, total, paymentMethod, customerInfo, orderNumber: on });
        res.status(201).json({ message: 'Order placed!', order: { orderNumber: on } });
    } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/track', async (req, res) => {
    try { await Visitor.create({ page: req.body.page, action: req.body.action, userId: null }); res.json({ message: 'Tracked' }); }
    catch (e) { res.status(500).json({ message: 'Error' }); }
});

const adminAuth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    try { const d = jwt.verify(token, process.env.JWT_SECRET || 'zippcart_secret_key_2024'); if (d.role !== 'admin') return res.status(403).json({ message: 'Admin only' }); req.user = d; next(); }
    catch (e) { res.status(401).json({ message: 'Invalid token' }); }
};

app.get('/api/admin/stats', adminAuth, async (req, res) => {
    try {
        const v = await Visitor.countDocuments();
        const o = await Order.countDocuments();
        const r = await Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]);
        const p = await User.countDocuments({ role: 'seller', status: 'pending' });
        res.json({ visitors: v, orders: o, revenue: r[0]?.total || 0, pendingSellers: p });
    } catch (e) { res.status(500).json({ message: 'Error' }); }
});

app.get('/api/admin/pending-sellers', adminAuth, async (req, res) => {
    try { const s = await User.find({ role: 'seller', status: 'pending' }); res.json(s); }
    catch (e) { res.status(500).json({ message: 'Error' }); }
});

app.put('/api/admin/seller/:id', adminAuth, async (req, res) => {
    try { await User.findByIdAndUpdate(req.params.id, { status: req.body.status }); res.json({ message: `Seller ${req.body.status}` }); }
    catch (e) { res.status(500).json({ message: 'Error' }); }
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
    try { const o = await Order.find().sort({ createdAt: -1 }).limit(20); res.json(o); }
    catch (e) { res.status(500).json({ message: 'Error' }); }
});

app.get('/api/admin/visitors', adminAuth, async (req, res) => {
    try { const v = await Visitor.find().sort({ timestamp: -1 }).limit(50); res.json(v); }
    catch (e) { res.status(500).json({ message: 'Error' }); }
});

// CLEAR ENDPOINTS
app.delete('/api/admin/visitors', adminAuth, async (req, res) => {
    try { await Visitor.deleteMany({}); res.json({ message: 'All visitor logs cleared' }); }
    catch (e) { res.status(500).json({ message: 'Error' }); }
});

app.delete('/api/admin/orders', adminAuth, async (req, res) => {
    try { await Order.deleteMany({}); res.json({ message: 'All orders cleared' }); }
    catch (e) { res.status(500).json({ message: 'Error' }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Zippcart server on port ${PORT}`));