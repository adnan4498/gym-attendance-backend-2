const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Client = require('../models/Client');
const Attendance = require('../models/Attendance');

// Multer configuration for public photo upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../uploads/'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'client-' + uniqueSuffix + path.extname(file.originalname));
  }
});

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

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

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
  console.log('Photo upload request for client:', req.params.id);
  try {
    console.log('req.file:', req.file);
    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ message: 'No photo uploaded' });
    }

    console.log('Finding client...');
    const client = await Client.findById(req.params.id);
    console.log('Client found:', !!client);
    if (!client) {
      console.log('Client not found');
      return res.status(404).json({ message: 'Client not found' });
    }

    console.log('client.photo before:', client.photo, 'typeof:', typeof client.photo);
    // Remove old photo if exists
    if (client.photo && typeof client.photo === 'string') {
      let oldPhotoPath;
      if (client.photo.startsWith('/uploads/')) {
        oldPhotoPath = path.join(__dirname, '../', client.photo.replace('/uploads/', 'uploads/'));
      } else if (client.photo.startsWith('http')) {
        try {
          const url = new URL(client.photo);
          oldPhotoPath = path.join(__dirname, '../uploads/', url.pathname.replace('/uploads/', ''));
        } catch {
          oldPhotoPath = path.join(__dirname, '../uploads/', client.photo);
        }
      } else {
        oldPhotoPath = path.join(__dirname, '../uploads/', client.photo);
      }
      console.log('Old photo path:', oldPhotoPath);
      if (fs.existsSync(oldPhotoPath)) {
        console.log('Deleting old photo');
        fs.unlinkSync(oldPhotoPath);
      } else {
        console.log('Old photo does not exist');
      }
    } else if (client.photo) {
      console.log('client.photo is not string, skipping delete');
    }

    console.log('req.file.filename:', req.file.filename);
    client.photo = `/uploads/${req.file.filename}`;
    console.log('client.photo after:', client.photo);
    console.log('Saving client...');
    await client.save();
    console.log('Client saved successfully');
    res.json(client);
  } catch (err) {
    console.error('Error in photo upload:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;