const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Client = require('../models/Client');
const Attendance = require('../models/Attendance');

// Check if running on Vercel
const isVercel = process.env.VERCEL === '1';

// Multer configuration for Vercel compatibility
let storage;

if (isVercel) {
  // For Vercel: Use memory storage (files stored in memory)
  storage = multer.memoryStorage();
} else {
  // For local development: Use disk storage
  storage = multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadsDir = path.join(__dirname, '../uploads/');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'client-' + uniqueSuffix + path.extname(file.originalname));
    }
  });
}

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|avif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images (jpeg, jpg, png, gif, avif) are allowed!'));
    }
  }
});

// Get all clients
router.get('/all', async (req, res) => {
  try {
    console.log('Fetching all clients...');
    const clients = await Client.find().populate('trainer');
    console.log('Clients found:', clients.length);
    res.json(clients);
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ message: err.message });
  }
});

// Search clients by name
router.get('/search', async (req, res) => {
  try {
    const { name } = req.query;
    const clients = await Client.find({ name: new RegExp(name, 'i') });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Time in
router.post('/:id/timein', async (req, res) => {
  try {
    const attendance = new Attendance({ client: req.params.id, timeIn: new Date() });
    await attendance.save();
    res.json(attendance);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Get active attendance for client
router.get('/:id/attendance', async (req, res) => {
  try {
    const attendance = await Attendance.findOne({ client: req.params.id, timeOut: null });
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all attendances for client
router.get('/:id/attendances', async (req, res) => {
  try {
    const attendances = await Attendance.find({ client: req.params.id }).sort({ createdAt: -1 });
    res.json(attendances);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete today's attendances for client
router.delete('/:id/attendances/today', async (req, res) => {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await Attendance.deleteMany({
      client: req.params.id,
      date: { $gte: today, $lt: tomorrow }
    });
    res.json({ message: 'Today\'s attendances deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Time out
router.put('/:id/timeout', async (req, res) => {
  try {
    const attendance = await Attendance.findOneAndUpdate(
      { client: req.params.id, timeOut: null },
      { timeOut: new Date() },
      { new: true }
    );
    res.json(attendance);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Upload photo for client (public route)
router.post('/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const clientId = req.params.id;
    const client = await Client.findById(clientId);
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Handle Vercel vs local differently
    if (isVercel) {
      // Vercel: Store as Base64 in MongoDB
      client.photo = {
        data: req.file.buffer.toString('base64'),
        contentType: req.file.mimetype,
        uploadedAt: new Date()
      };
    } else {
      // Local development: Store file path
      // Remove old photo if exists
      if (client.photo && client.photo.startsWith('/uploads/')) {
        const oldPhotoPath = path.join(__dirname, '..', client.photo);
        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }
      client.photo = `/uploads/${req.file.filename}`;
    }
    
    await client.save();
    
    res.json({
      success: true,
      message: 'Photo uploaded successfully',
      client: {
        id: client._id,
        name: client.name,
        hasPhoto: true
      }
    });
    
  } catch (error) {
    console.error('Error uploading photo:', error);
    res.status(500).json({ 
      error: 'Failed to upload photo',
      message: error.message 
    });
  }
});

module.exports = router;