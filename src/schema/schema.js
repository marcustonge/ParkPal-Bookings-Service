const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    user_id: String,
    location_id: String,
    start_time: Date,
    end_time: Date,
    street_address: String,
});

const Booking = mongoose.model('Booking',bookingSchema);
module.exports = Booking;