const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const Client = require('./models/Client');

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/') // Store files in 'uploads' directory
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
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
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}
const Attendance = require('./models/Attendance');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 5000 ;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://akhan123456008_db_user:YmFQqOSxQScSSMjX@cluster0.uxjhait.mongodb.net/attendance?appName=cluster0')
.then(() => console.log('MongoDB connected'))
.catch(err => console.log('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/client', require('./routes/client'));
app.use('/api/trainers', require('./routes/trainers'));

app.get('/', (req, res) => {
  res.send('Attendance Backend API');
});

// Evolution API WhatsApp setup
const evolutionApiUrl = process.env.EVOLUTION_API_URL; // e.g., 'http://localhost:8080'
const evolutionApiKey = process.env.EVOLUTION_API_KEY;
const evolutionInstance = process.env.EVOLUTION_INSTANCE; // e.g., 'instance1'

// Function to send WhatsApp message
const sendWhatsAppMessage = async (to, message) => {
  try {
    const response = await axios.post(`${evolutionApiUrl}/message/sendText/${evolutionInstance}`, {
      number: to,
      text: message
    }, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionApiKey
      }
    });
    console.log(`WhatsApp message sent to ${to}`, response.data);
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
  }
};

// Function to check and send fee reminders
const sendFeeReminders = async () => {
  try {
    const clients = await Client.find({});
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const client of clients) {
      const feeDate = new Date(client.feeSubmissionDate);
      const nextFee = new Date(feeDate.getFullYear(), feeDate.getMonth() + 1, feeDate.getDate());
      const diffTime = nextFee - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let message = '';
      if (diffDays === 7) {
        message = `Hi ${client.name}, your gym fee is due in 7 days. Please prepare to pay.`;
      } else if (diffDays === 3) {
        message = `Hi ${client.name}, your gym fee is due in 3 days. Please make the payment soon.`;
      } else if (diffDays === 0) {
        message = `Hi ${client.name}, your gym fee is due today. Please pay immediately to avoid any issues.`;
      }

      if (message && client.phone) {
        await sendWhatsAppMessage(client.phone, message);
      }
    }
  } catch (error) {
    console.error('Error sending fee reminders:', error);
  }
};

// Function to backup data
const backupData = async () => {
  try {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup-${timestamp}.json`);

    const clients = await Client.find({});
    const attendances = await Attendance.find({});
    const users = await User.find({});

    const backupData = {
      clients,
      attendances,
      users,
      timestamp: new Date()
    };

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    console.log(`Backup created: ${backupFile}`);

    // Keep only last 7 backups
    const files = fs.readdirSync(backupDir).sort().reverse();
    if (files.length > 7) {
      files.slice(7).forEach(file => {
        fs.unlinkSync(path.join(backupDir, file));
      });
    }
  } catch (error) {
    console.error('Error creating backup:', error);
  }
};

// Schedule daily check at 9 AM
cron.schedule('0 9 * * *', () => {
  console.log('Running daily fee reminder check');
  sendFeeReminders();
});

// Schedule daily backup at 2 AM
cron.schedule('0 2 * * *', () => {
  console.log('Running daily data backup');
  backupData();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler triggered:', err.message || err);
  if (err.message && err.message.includes('Only images')) {
    console.log('Handling image error');
    return res.status(400).json({ message: err.message });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    console.log('Handling file size error');
    return res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }
  console.log('Unhandled error');
  res.status(500).json({ message: err.message || 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});