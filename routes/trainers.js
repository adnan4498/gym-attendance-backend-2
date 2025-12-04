const express = require('express');
const Trainer = require('../models/Trainer');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all trainers
router.get('/', auth, async (req, res) => {
  try {
    const trainers = await Trainer.find().sort({ name: 1 });
    res.json(trainers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add new trainer
router.post('/', auth, async (req, res) => {
  try {
    const trainer = new Trainer({
      name: req.body.name
    });
    const newTrainer = await trainer.save();
    res.status(201).json(newTrainer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete trainer
router.delete('/:id', auth, async (req, res) => {
  try {
    await Trainer.findByIdAndDelete(req.params.id);
    res.json({ message: 'Trainer deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;