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

// Middleware - UPDATED CORS
app.use(cors({
  origin: [
    'https://gym-attendance-frontend.vercel.app', // Your frontend URL
    'http://localhost:5173' // Local dev
  ],
  credentials: true
}));
app.use(express.json());

// Serve uploaded files - handle Vercel's /tmp directory
if (isVercel) {
  app.use('/uploads', express.static('/tmp/uploads'));
} else {
  app.use('/uploads', express.static('uploads'));
}

// SIMPLIFIED MongoDB Connection for Vercel
const connectDB = async () => {
  try {
    const mongoURL = process.env.MONGO_URL;
    
    if (!mongoURL) {
      console.error("❌ MONGO_URL is not defined in environment variables");
      return false;
    }
    
    console.log("🔗 Connecting to MongoDB...");
    
    // Simple connection without complex options
    await mongoose.connect(mongoURL);
    
    console.log("✅ MongoDB connected successfully");
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log(`🌐 Host: ${mongoose.connection.host}`);
    
    return true;
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    
    // Try one more time with basic options
    try {
      console.log("🔄 Trying alternative connection method...");
      await mongoose.connect(mongoURL, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log("✅ MongoDB connected on second attempt");
      return true;
    } catch (retryError) {
      console.error("💥 Second connection attempt failed:", retryError.message);
      return false;
    }
  }
};

// Initialize DB connection immediately
let isDBConnected = false;
(async () => {
  try {
    isDBConnected = await connectDB();
    if (isDBConnected) {
      console.log("🚀 Database connection initialized successfully");
    } else {
      console.error("💥 Failed to initialize database connection");
    }
  } catch (error) {
    console.error("💥 Error initializing database:", error);
  }
})();

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

// Direct connection test without mongoose
app.get('/api/test-direct-connection', async (req, res) => {
  const { MongoClient } = require('mongodb');
  const mongoURL = process.env.MONGO_URL;
  
  if (!mongoURL) {
    return res.status(400).json({ error: 'MONGO_URL not set' });
  }
  
  try {
    const client = new MongoClient(mongoURL, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    
    console.log(`Testing direct connection to: ${mongoURL.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`);
    
    await client.connect();
    const pingResult = await client.db("admin").command({ ping: 1 });
    const databases = await client.db().admin().listDatabases();
    
    // Check if our database exists
    const attendanceDB = databases.databases.find(db => db.name === 'attendance');
    
    await client.close();
    
    res.json({
      success: true,
      message: 'Direct MongoDB connection successful!',
      ping: pingResult,
      databaseExists: !!attendanceDB,
      availableDatabases: databases.databases.map(db => db.name),
      connectionURL: mongoURL.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      errorCode: error.code,
      errorName: error.name,
      advice: 'The connection string itself is failing. Check: 1. MongoDB Atlas Network Access 2. Username/password 3. Cluster might be paused/sleeping',
      testCommand: `Try running: mongosh "${mongoURL}"`
    });
  }
});

// Test MongoDB connection endpoint - UPDATED
app.get('/api/test-mongodb', async (req, res) => {
  try {
    const connectionState = mongoose.connection.readyState;
    
    // If disconnected, try to reconnect once
    if (connectionState === 0) {
      console.log("⚠️ MongoDB disconnected, attempting quick reconnect...");
      try {
        await mongoose.connect(process.env.MONGO_URL);
      } catch (reconnectError) {
        console.log("❌ Quick reconnect failed:", reconnectError.message);
      }
    }
    
    const newConnectionState = mongoose.connection.readyState;
    
    if (newConnectionState === 1) {
      res.json({ 
        status: 'success',
        message: 'MongoDB is connected',
        connectionState: newConnectionState,
        stateDescription: 'connected',
        host: mongoose.connection.host,
        database: mongoose.connection.name,
        timestamp: new Date().toISOString()
      });
    } else {
      // Test the connection string directly
      const { MongoClient } = require('mongodb');
      const mongoURL = process.env.MONGO_URL;
      
      try {
        const client = new MongoClient(mongoURL, {
          serverSelectionTimeoutMS: 10000
        });
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        await client.close();
        
        res.json({
          status: 'partial_success',
          message: 'MongoDB connection string works, but mongoose is disconnected',
          mongooseState: newConnectionState,
          directConnection: 'success',
          advice: 'Mongoose connection may have timed out. The connection string itself is valid.'
        });
      } catch (directError) {
        res.status(503).json({
          status: 'error',
          message: 'MongoDB connection failed',
          connectionState: newConnectionState,
          stateDescription: 'disconnected',
          directConnectionError: directError.message,
          advice: `Check: 1. Network Access in MongoDB Atlas (you have 0.0.0.0/0) 2. Connection string 3. Try this exact URL in MongoDB Compass: ${mongoURL?.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`,
          timestamp: new Date().toISOString()
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      status: 'critical_error',
      message: 'Error testing MongoDB connection',
      error: error.message,
      connectionState: mongoose.connection.readyState,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Gym Attendance Backend</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        .status { padding: 10px; margin: 10px 0; border-radius: 5px; font-weight: bold; }
        .connected { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .disconnected { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .endpoint { background: #e9ecef; padding: 10px; margin: 10px 0; border-radius: 5px; }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🏋️ Gym Attendance Backend API</h1>
        <p>Backend successfully deployed on Vercel</p>
        
        <div class="status ${mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'}">
          MongoDB Status: ${mongoose.connection.readyState === 1 ? '✅ CONNECTED' : '❌ DISCONNECTED'}
        </div>
        
        <h3>Test Endpoints:</h3>
        <div class="endpoint">
          <a href="/api/health" target="_blank">/api/health</a> - Health check
        </div>
        <div class="endpoint">
          <a href="/api/check-connection" target="_blank">/api/check-connection</a> - Connection status
        </div>
        <div class="endpoint">
          <a href="/api/test-direct-connection" target="_blank">/api/test-direct-connection</a> - Direct MongoDB test
        </div>
        <div class="endpoint">
          <a href="/api/debug/env" target="_blank">/api/debug/env</a> - Environment variables
        </div>
        
        <p><strong>Frontend:</strong> Update your frontend .env to use: <code>VITE_API_URL=https://gym-attendance-backend-2.vercel.app</code></p>
      </div>
    </body>
    </html>
  `);
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