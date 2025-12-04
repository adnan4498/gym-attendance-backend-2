const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  timeIn: { type: Date, required: true },
  timeOut: { type: Date },
  date: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Attendance', attendanceSchema);