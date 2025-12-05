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

// FIXED: Proper multer configuration for Vercel
let storage;
let upload;

if (isVercel) {
  // For Vercel: Use memory storage (files stored in memory, not disk)
  storage = multer.memoryStorage();
  
  // Create /tmp/uploads directory for temporary file serving
  const tmpUploadsPath = '/tmp/uploads';
  if (!fs.existsSync(tmpUploadsPath)) {
    fs.mkdirSync(tmpUploadsPath, { recursive: true });
  }
} else {
  // For local development: Use disk storage
  storage = multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadsDir = 'uploads/';
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  });
}

upload = multer({ 
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

const Attendance = require('./models/Attendance');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware - UPDATED CORS with your actual frontend URL
app.use(cors({
  origin: '*', // Allow all for now, we'll fix this later
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Serve uploaded files - handle Vercel's /tmp directory
if (isVercel) {
  app.use('/uploads', express.static('/tmp/uploads'));
} else {
  app.use('/uploads', express.static('uploads'));
}

// FIXED: Global connection caching for Vercel serverless
let cachedConnection = null;

async function connectToDatabase() {
  if (cachedConnection && mongoose.connection.readyState === 1) {
    console.log('✅ Using cached MongoDB connection');
    return cachedConnection;
  }

  try {
    console.log('🔗 Creating new MongoDB connection...');
    
    const mongoURL = process.env.MONGO_URL;
    
    if (!mongoURL) {
      throw new Error('MONGO_URL environment variable is not set');
    }
    
    // Mask password in logs
    const maskedURL = mongoURL.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
    console.log(`📡 Connecting to: ${maskedURL}`);
    
    // FIXED: Simple connection without deprecated options
    const connection = await mongoose.connect(mongoURL);
    
    console.log('✅ MongoDB connected successfully!');
    cachedConnection = connection;
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
      cachedConnection = null;
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB disconnected');
      cachedConnection = null;
    });
    
    return connection;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('Full error:', error);
    throw error;
  }
}

// FIXED: Middleware to ensure DB connection before routes
app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    console.error('Database connection middleware failed:', error);
    res.status(500).json({ 
      error: 'Database connection failed',
      message: error.message,
      advice: 'Check your MONGO_URL environment variable and MongoDB Atlas network settings'
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

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/client', require('./routes/client'));
app.use('/api/trainers', require('./routes/trainers'));

// Test if routes are working
app.get('/api/test-routes', async (req, res) => {
  try {
    await connectToDatabase();
    
    // Test if we can access collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    res.json({
      success: true,
      message: 'Routes are working',
      database: mongoose.connection.name,
      collections: collectionNames,
      clientCount: await Client.countDocuments(),
      userCount: await User.countDocuments(),
      attendanceCount: await Attendance.countDocuments()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      advice: 'Database operations failing'
    });
  }
});

// Add a test upload endpoint for Vercel file handling
app.post('/api/test-upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    let fileInfo;
    
    if (isVercel) {
      // For Vercel: File is in memory buffer
      fileInfo = {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        storage: 'memory (base64)',
        base64Preview: req.file.buffer.toString('base64').substring(0, 100) + '...'
      };
    } else {
      // For local: File is on disk
      fileInfo = {
        filename: req.file.filename,
        path: req.file.path,
        mimetype: req.file.mimetype,
        size: req.file.size,
        storage: 'disk'
      };
    }
    
    res.json({
      success: true,
      message: 'File uploaded successfully',
      file: fileInfo,
      environment: isVercel ? 'vercel' : 'local'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await connectToDatabase();
    res.status(200).json({ 
      status: 'OK', 
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      readyState: mongoose.connection.readyState,
      stateDescription: getStateDescription(mongoose.connection.readyState),
      timestamp: new Date().toISOString(),
      environment: isVercel ? 'vercel' : 'local',
      database: mongoose.connection.name
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      mongodb: 'connection_failed',
      error: error.message,
      timestamp: new Date().toISOString(),
      advice: 'Check MONGO_URL environment variable'
    });
  }
});

// Simple connection test
app.get('/api/check-connection', async (req, res) => {
  const mongoURL = process.env.MONGO_URL;
  
  try {
    await connectToDatabase();
    
    res.json({
      success: true,
      hasMongoURL: !!mongoURL,
      mongoURLLength: mongoURL?.length,
      connectionState: mongoose.connection.readyState,
      stateDescription: getStateDescription(mongoose.connection.readyState),
      environment: process.env.NODE_ENV,
      isVercel: isVercel,
      database: mongoose.connection.name,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      success: false,
      hasMongoURL: !!mongoURL,
      mongoURLLength: mongoURL?.length,
      connectionState: mongoose.connection.readyState,
      stateDescription: getStateDescription(mongoose.connection.readyState),
      error: error.message,
      timestamp: new Date().toISOString(),
      advice: 'Connection failed. Check MONGO_URL and MongoDB Atlas settings.'
    });
  }
});

// List all environment variables (for debugging - remove in production)
app.get('/api/debug/env', (req, res) => {
  const envVars = {
    NODE_ENV: process.env.NODE_ENV,
    MONGO_URL_SET: !!process.env.MONGO_URL,
    MONGO_URL_LENGTH: process.env.MONGO_URL?.length,
    VERCEL: process.env.VERCEL,
    PORT: process.env.PORT,
    isVercel: isVercel,
    nodeVersion: process.version,
    platform: process.platform,
    // Don't show full MONGO_URL for security
  };
  res.json(envVars);
});

// Direct connection test without mongoose - FIXED
app.get('/api/test-direct-connection', async (req, res) => {
  const mongoURL = process.env.MONGO_URL;
  
  if (!mongoURL) {
    return res.status(400).json({ error: 'MONGO_URL not set' });
  }
  
  try {
    // Use mongoose's driver directly
    const connection = mongoose.connection;
    if (!connection.db) {
      await connectToDatabase();
    }
    
    const pingResult = await connection.db.admin().ping();
    
    res.json({
      success: true,
      message: 'Direct MongoDB connection successful!',
      ping: pingResult,
      database: connection.name,
      host: connection.host,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    // Try direct mongodb driver as fallback
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(mongoURL);
      await client.connect();
      const pingResult = await client.db("admin").command({ ping: 1 });
      await client.close();
      
      res.json({
        success: true,
        message: 'MongoDB driver connection successful!',
        ping: pingResult,
        driver: 'native-mongodb',
        timestamp: new Date().toISOString()
      });
    } catch (driverError) {
      res.status(500).json({
        success: false,
        error: driverError.message,
        mongooseError: error.message,
        advice: 'The connection string itself is failing. Check: 1. MongoDB Atlas Network Access (0.0.0.0/0) 2. Username/password 3. Cluster status',
        timestamp: new Date().toISOString()
      });
    }
  }
});

// Test MongoDB connection endpoint
app.get('/api/test-mongodb', async (req, res) => {
  try {
    await connectToDatabase();
    
    const connectionState = mongoose.connection.readyState;
    
    if (connectionState === 1) {
      // Try to ping the database
      const pingResult = await mongoose.connection.db.admin().ping();
      
      res.json({ 
        status: 'success',
        message: 'MongoDB is connected and responsive',
        ping: pingResult,
        connectionState: connectionState,
        stateDescription: 'connected',
        host: mongoose.connection.host,
        database: mongoose.connection.name,
        timestamp: new Date().toISOString(),
        environment: isVercel ? 'vercel' : 'local'
      });
    } else {
      res.status(503).json({
        status: 'error',
        message: 'MongoDB is not connected',
        connectionState: connectionState,
        stateDescription: getStateDescription(connectionState),
        advice: 'Database connection failed. Check MongoDB Atlas settings.',
        timestamp: new Date().toISOString()
      });
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

app.get('/', async (req, res) => {
  try {
    await connectToDatabase();
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const statusClass = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const statusIcon = mongoose.connection.readyState === 1 ? '✅' : '❌';
    
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
          code { background: #f8f9fa; padding: 2px 5px; border-radius: 3px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🏋️ Gym Attendance Backend API</h1>
          <p>Backend successfully deployed on Vercel</p>
          
          <div class="status ${statusClass}">
            MongoDB Status: ${statusIcon} ${dbStatus.toUpperCase()} (State: ${mongoose.connection.readyState})
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
          <div class="endpoint">
            <a href="/api/test-routes" target="_blank">/api/test-routes</a> - Test API routes
          </div>
          
          <h3>File Upload Test:</h3>
          <div class="endpoint">
            <form id="uploadForm">
              <input type="file" name="image" accept="image/*" required>
              <button type="submit">Test Upload</button>
            </form>
            <div id="uploadResult"></div>
          </div>
          
          <p><strong>Frontend Configuration:</strong></p>
          <p>Update your frontend .env file with:</p>
          <code>VITE_API_URL=https://gym-attendance-backend-2.vercel.app</code>
          
          <p><strong>Environment:</strong> ${isVercel ? 'Vercel (Serverless)' : 'Local Development'}</p>
          <p><strong>Database:</strong> ${mongoose.connection.name || 'Not connected'}</p>
          <p><strong>Mongoose Version:</strong> ${mongoose.version}</p>
        </div>
        
        <script>
          document.getElementById('uploadForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData();
            formData.append('image', e.target.image.files[0]);
            
            try {
              const response = await fetch('/api/test-upload', {
                method: 'POST',
                body: formData
              });
              const result = await response.json();
              document.getElementById('uploadResult').innerHTML = 
                '<pre>' + JSON.stringify(result, null, 2) + '</pre>';
            } catch (error) {
              document.getElementById('uploadResult').innerHTML = 
                'Error: ' + error.message;
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Error</title><style>body{font-family:Arial;margin:40px;}</style></head>
      <body>
        <h1>⚠️ Database Connection Error</h1>
        <p><strong>Error:</strong> ${error.message}</p>
        <p><strong>Advice:</strong> Check your MONGO_URL environment variable in Vercel settings</p>
        <p><strong>Current MONGO_URL:</strong> ${process.env.MONGO_URL ? 'Set (' + process.env.MONGO_URL.length + ' chars)' : 'Not set'}</p>
        <p><a href="/api/debug/env">View Environment Variables</a></p>
      </body>
      </html>
    `);
  }
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