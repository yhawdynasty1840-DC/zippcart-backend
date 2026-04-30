const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: __dirname + '/.env' });

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://zippcart_admin:44fLoMRA8awIZNST@ac-dixdnuf-shard-00-00.mbht8ka.mongodb.net:27017,ac-dixdnuf-shard-00-01.mbht8ka.mongodb.net:27017,ac-dixdnuf-shard-00-02.mbht8ka.mongodb.net:27017/zippcart?ssl=true&authSource=admin';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.log('❌ MongoDB Error:', err.message));

// Models
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
    role: { type: String, default: 'customer' },
    status: { type: String, default: 'active' },
    businessName: String,
    businessType: String,
    phone: String,
    products: String,
    monthlySales: String,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

const visitorSchema = new mongoose.Schema({
    page: String,
    action: String,
    userId: String,
    timestamp: { type: Date, default: Date.now }
});

const Visitor = mongoose.model('Visitor', visitorSchema);

const orderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    items: Array,
    total: Number,
    paymentMethod: String,
    status: { type: String, default: 'pending' },
    customerInfo: Object,
    orderNumber: String,
    createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

// ==================== PUBLIC ROUTES ====================

app.get('/', (req, res) => {
    res.json({ message: 'Welcome to Zippcart API' });
});

// ==================== AUTH ROUTES ====================

app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already registered' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ name, email, password: hashedPassword, role: 'customer' });
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'zippcart_secret_key_2024',
            { expiresIn: '7d' }
        );
        res.status(201).json({ message: 'Account created successfully', token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid email or password' });
        if (user.role === 'seller' && user.status === 'pending') {
            return res.status(403).json({ message: 'Your seller account is pending approval' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' });
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'zippcart_secret_key_2024',
            { expiresIn: '7d' }
        );
        res.json({ message: 'Login successful', token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ==================== SELLER REGISTRATION ====================

app.post('/api/seller/register', async (req, res) => {
    try {
        const { businessName, businessType, contactPerson, phone, email, products, monthlySales } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'Email already registered' });
        const seller = await User.create({
            name: contactPerson, email, phone,
            password: await bcrypt.hash('temporary123', 10),
            role: 'seller', status: 'pending',
            businessName, businessType, products, monthlySales
        });
        res.status(201).json({ message: 'Seller application submitted! Waiting for admin approval.', sellerId: seller._id });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ==================== ORDER ROUTES ====================

app.post('/api/orders', async (req, res) => {
    try {
        const { items, total, paymentMethod, customerInfo } = req.body;
        const token = req.headers.authorization?.split(' ')[1];
        let userId = null;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'zippcart_secret_key_2024');
            userId = decoded.id;
        }
        const orderNumber = 'ZIP-' + Date.now().toString().slice(-8);
        await Order.create({ userId, items, total, paymentMethod, customerInfo, orderNumber, status: 'pending' });
        res.status(201).json({ message: 'Order placed successfully!', order: { orderNumber } });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ==================== VISITOR TRACKING ====================

app.post('/api/track', async (req, res) => {
    try {
        const { page, action } = req.body;
        await Visitor.create({ page, action, userId: null });
        res.json({ message: 'Tracked' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// ==================== ADMIN ROUTES ====================

const adminAuth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'zippcart_secret_key_2024');
        if (decoded.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid token' });
    }
};

app.get('/api/admin/stats', adminAuth, async (req, res) => {
    try {
        const visitors = await Visitor.countDocuments();
        const orders = await Order.countDocuments();
        const revenue = await Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]);
        const pendingSellers = await User.countDocuments({ role: 'seller', status: 'pending' });
        res.json({ visitors, orders, revenue: revenue[0]?.total || 0, pendingSellers });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/admin/pending-sellers', adminAuth, async (req, res) => {
    try {
        const sellers = await User.find({ role: 'seller', status: 'pending' });
        res.json(sellers);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.put('/api/admin/seller/:id', adminAuth, async (req, res) => {
    try {
        const { status } = req.body;
        await User.findByIdAndUpdate(req.params.id, { status });
        res.json({ message: `Seller ${status}` });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 }).limit(20);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/admin/visitors', adminAuth, async (req, res) => {
    try {
        const visitors = await Visitor.find().sort({ timestamp: -1 }).limit(50);
        res.json(visitors);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Zippcart server running on port ${PORT}`);
});