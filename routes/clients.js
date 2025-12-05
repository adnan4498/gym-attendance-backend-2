const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Client = require('../models/Client');
const auth = require('../middleware/auth');

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
router.get('/', auth, async (req, res) => {
  try {
    const clients = await Client.find().populate('trainer');
    
    // Add photoUrl to each client
    const clientsWithPhotoUrl = clients.map(client => ({
      ...client._doc,
      photoUrl: `/api/clients/${client._id}/photo`
    }));
    
    res.json(clientsWithPhotoUrl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single client with photoUrl
router.get('/:id', auth, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id).populate('trainer');
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }
    
    const clientWithPhotoUrl = {
      ...client._doc,
      photoUrl: `/api/clients/${client._id}/photo`
    };
    
    res.json(clientWithPhotoUrl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get client photo
router.get('/:id/photo', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    
    if (!client || !client.photo || !client.photo.data) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    // Convert base64 to buffer and send as image
    const imgBuffer = Buffer.from(client.photo.data, 'base64');
    
    // Set proper headers
    res.set('Content-Type', client.photo.contentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    
    res.send(imgBuffer);
    
  } catch (error) {
    console.error('Error serving photo:', error);
    res.status(500).json({ error: 'Failed to serve photo' });
  }
});

// Add client
router.post('/', auth, async (req, res) => {
  try {
    const client = new Client(req.body);
    await client.save();
    
    const clientWithPhotoUrl = {
      ...client._doc,
      photoUrl: `/api/clients/${client._id}/photo`
    };
    
    res.json(clientWithPhotoUrl);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Upload photo for client (with auth)
router.post('/:id/photo', auth, upload.single('photo'), async (req, res) => {
  try {
    const clientId = req.params.id;
    const client = await Client.findById(clientId);
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
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
        hasPhoto: true,
        photoUrl: `/api/clients/${client._id}/photo`
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

// Update client
router.put('/:id', auth, async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true });
    
    const clientWithPhotoUrl = {
      ...client._doc,
      photoUrl: `/api/clients/${client._id}/photo`
    };
    
    res.json(clientWithPhotoUrl);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete client
router.delete('/:id', auth, async (req, res) => {
  try {
    await Client.findByIdAndDelete(req.params.id);
    res.json({ message: 'Client deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;