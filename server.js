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

// IMPORTANT: For Vercel, we need to handle serverless environment
const isVercel = process.env.VERCEL === '1';

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

// For Vercel, create uploads directory in /tmp (writable directory)
if (isVercel) {
  const tmpUploadsPath = '/tmp/uploads';
  if (!fs.existsSync(tmpUploadsPath)) {
    fs.mkdirSync(tmpUploadsPath, { recursive: true });
  }
  // Update multer storage for Vercel
  storage.destination = tmpUploadsPath;
} else {
  // Local development
  if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
  }
}

const Attendance = require('./models/Attendance');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve uploaded files - handle Vercel's /tmp directory
if (isVercel) {
  app.use('/uploads', express.static('/tmp/uploads'));
} else {
  app.use('/uploads', express.static('uploads'));
}

// MongoDB Connection with retry logic
// MongoDB Connection with better error handling
// MongoDB Connection with better error handling
const connectDB = async () => {
  const maxRetries = 3;
  let retries = 0;
  
  const connectWithRetry = async () => {
    try {
      const mongoURL = process.env.MONGO_URL;
      
      if (!mongoURL) {
        console.error("❌ MONGO_URL is not defined in environment variables");
        return false;
      }
      
      console.log(`🔗 Attempting MongoDB connection (attempt ${retries + 1}/${maxRetries})...`);
      
      // Log a masked version of the URL for debugging (hides password)
      const maskedURL = mongoURL.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
      console.log(`🔗 Connecting to: ${maskedURL}`);
      
      await mongoose.connect(mongoURL, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000, // 30 seconds
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
      });
      
      console.log("✅ MongoDB connected successfully");
      console.log(`📊 Database: ${mongoose.connection.name}`);
      console.log(`🌐 Host: ${mongoose.connection.host}`);
      
      return true;
      
    } catch (err) {
      retries++;
      console.error(`❌ MongoDB connection failed (attempt ${retries}/${maxRetries}):`, err.message);
      
      if (retries < maxRetries) {
        console.log(`⏳ Retrying in 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return connectWithRetry();
      } else {
        console.error("💥 Max retries reached. Could not connect to MongoDB.");
        return false;
      }
    }
  };
  
  return connectWithRetry();
};

// Test MongoDB connection endpoint
app.get('/api/test-mongodb', async (req, res) => {
  try {
    const connectionState = mongoose.connection.readyState;
    
    // readyState values:
    // 0 = disconnected
    // 1 = connected
    // 2 = connecting
    // 3 = disconnecting
    
    if (connectionState === 1) {
      // Try to ping MongoDB only if connected
      try {
        const pingResult = await mongoose.connection.db.admin().ping();
        res.json({ 
          status: 'success',
          message: 'MongoDB is connected and responsive',
          ping: pingResult,
          connectionState: connectionState,
          stateDescription: 'connected',
          host: mongoose.connection.host,
          database: mongoose.connection.name,
          collections: await mongoose.connection.db.listCollections().toArray()
        });
      } catch (pingError) {
        res.json({
          status: 'warning',
          message: 'MongoDB appears connected but ping failed',
          connectionState: connectionState,
          stateDescription: 'connected (ping failed)',
          error: pingError.message
        });
      }
    } else {
      res.status(503).json({
        status: 'error',
        message: 'MongoDB is not connected',
        connectionState: connectionState,
        stateDescription: getStateDescription(connectionState),
        advice: 'Check 1) MongoDB Atlas Network Access 2) Connection string 3) Internet connectivity',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({
      status: 'critical_error',
      message: 'Error testing MongoDB connection',
      error: error.message,
      connectionState: mongoose.connection.readyState,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
    });
  }
});

// Helper function
function getStateDescription(state) {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  return states[state] || 'unknown';
}

// List all environment variables (for debugging - remove in production)
app.get('/api/debug/env', (req, res) => {
  const envVars = {
    NODE_ENV: process.env.NODE_ENV,
    MONGO_URL_SET: !!process.env.MONGO_URL,
    MONGO_URL_LENGTH: process.env.MONGO_URL?.length,
    VERCEL: process.env.VERCEL,
    PORT: process.env.PORT,
    // Don't show full MONGO_URL for security
  };
  res.json(envVars);
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/client', require('./routes/client'));
app.use('/api/trainers', require('./routes/trainers'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Simple connection test
app.get('/api/check-connection', (req, res) => {
  const mongoURL = process.env.MONGO_URL;
  
  res.json({
    hasMongoURL: !!mongoURL,
    mongoURLLength: mongoURL?.length,
    connectionState: mongoose.connection.readyState,
    stateDescription: getStateDescription(mongoose.connection.readyState),
    environment: process.env.NODE_ENV,
    isVercel: process.env.VERCEL === '1',
    timestamp: new Date().toISOString(),
    advice: 'If state is 0 (disconnected), check: 1. MongoDB Atlas Network Access (add 0.0.0.0/0) 2. Connection string validity 3. User permissions'
  });
});

// Add this test endpoint
app.get('/api/test-connection-string', async (req, res) => {
  const { MongoClient } = require('mongodb');
  const mongoURL = process.env.MONGO_URL;
  
  if (!mongoURL) {
    return res.json({ error: 'No MONGO_URL set' });
  }
  
  try {
    const client = new MongoClient(mongoURL);
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    await client.close();
    
    res.json({ 
      success: true, 
      message: 'Connection string is valid and working!' 
    });
  } catch (error) {
    res.json({ 
      success: false, 
      error: error.message,
      advice: 'Check: 1. Network Access in MongoDB Atlas 2. Username/password 3. Cluster name'
    });
  }
});

app.get('/', (req, res) => {
  res.send('Attendance Backend API - Deployed on Vercel');
});

// Evolution API WhatsApp setup (optional - remove if not needed)
const evolutionApiUrl = process.env.EVOLUTION_API_URL;
const evolutionApiKey = process.env.EVOLUTION_API_KEY;
const evolutionInstance = process.env.EVOLUTION_INSTANCE;

// Function to send WhatsApp message
const sendWhatsAppMessage = async (to, message) => {
  // Check if Evolution API is configured
  if (!evolutionApiUrl || !evolutionApiKey || !evolutionInstance) {
    console.log('Evolution API not configured, skipping WhatsApp message');
    return;
  }
  
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
    // In Vercel serverless, cron jobs should be handled differently
    // Consider using Vercel Cron Jobs or external cron service
    if (isVercel) {
      console.log('Cron jobs disabled in Vercel serverless environment');
      return;
    }
    
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
    // Skip backup in Vercel serverless environment
    if (isVercel) {
      console.log('Backup disabled in Vercel serverless environment');
      return;
    }
    
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

// Schedule tasks only if not in Vercel serverless
if (!isVercel) {
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
} else {
  console.log('Cron jobs disabled for Vercel deployment');
}

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

// For Vercel deployment, export the app as a serverless function
if (isVercel) {
  module.exports = app;
} else {
  // For local development
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}