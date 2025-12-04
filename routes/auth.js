const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  console.log(`Login attempt - username: ${username}, password: ${password ? '[HIDDEN]' : 'empty'}`);
  if (username === 'admin' && password === '123') {
    console.log('Login successful with hardcoded credentials');
    const token = jwt.sign({ username: 'admin', role: 'admin' }, 'secretkey', { expiresIn: '1h' });
    res.json({ token });
  } else {
    console.log('Login failed - invalid credentials');
    res.status(401).json({ message: 'Invalid credentials' });
  }
});

module.exports = router;