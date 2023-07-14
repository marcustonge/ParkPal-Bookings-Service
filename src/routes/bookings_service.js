const express = require("express");
const router = express.Router();
const Booking = require("../schema/schema");
const jwt = require("jwt-simple");
const axios = require("axios");

const jwtAlgorithm = "HS512";
const notificationUrl = process.env.NOTIFICATION_SERVICE_ENDPOINT;
const locationUrl = process.env.LOCATION_SERVICE_ENDPOINT;

// Seconds in the interval for 1 hour in milliseconds: 
// Interval of Hours * 60 minutes * 60 seconds * 1000 milliseconds
const expiredBookingsCheckInterval = 1 * 60 * 60 * 1000;

// Routes

router.delete("/delete/:id", async (req, res) => {

  try {

    // Get the JWT secret from the environment variables
    const secretKey = process.env.JWT_SECRET;
    // If this is not set we want to throw an error as this is required to retrieve the user
    // id from the provided token.
    if (secretKey == null) {
      console.error("JWT_SECRET is not set in the environment variables");
      return res
        .status(500)
        .send("JWT_SECRET is not set in the environment variables");
    }

    if(!req.headers.authorization){
      return res.status(400).json({ message: "No authorization header" }).send();
    }
    
    // Get the token from the request headers
    const token = req.headers.authorization.split(" ")[1];
    // Decode this token with the secret key
    const payload = jwt.decode(token, secretKey, false, jwtAlgorithm);
    // Get the user id from the decoded token payload.
    const userId = payload.id;

    const id = req.params.id;

    if (!id) {
      return res.status(400).json({ message: "Missing id required field" });
    }
    
    const booking = await Booking.findOne({
      _id: id,
      user_id: userId,
    });

    if (!booking) {
      return res.status(400).json({ message: "Booking not found" });
    }

    const locationId = booking.location_id;
    try {
        const response = await axios.post(`${locationUrl}/location/parking-location/increment/${locationId}`, {}, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ADMIN_TOKEN}`
        }
      });

      if (response.status > 299) {
        throw(`Could not increment free spaces in location ${locationId}`)
      }
    } catch (error) {
      return res.status(500).json({ message: `Internal server error: ${error}` });
    }

     const response= await Booking.deleteOne(booking);

     if (response.acknowledged == false) {
      await axios.post(`${locationUrl}/location/parking-location/decrement/${locationId}`, {}, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ADMIN_TOKEN}`
        }
      });
      return res.status(500).json({ message: "Could not delete booking" });
     }

    console.log('deleted booking with id ' + booking._id)

    return res.status(200).json({
      message: 'Removed booking with id ' + booking._id
    });

  } catch (error) {
    return res.status(500).json({ message: "Internal server error " + error });  
  }
});

router.post("/create", async (req, res) => {
  try {
    const {
      location_id,
      // Start time of the booking in the format of yyyy-mm-ddThh:mm:ss
      start_time,
      // Number of hours from the start time
      expires_hours,
    } = req.body;

    if (!location_id || !start_time || !expires_hours) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Get the JWT secret from the environment variables
    const secretKey = process.env.JWT_SECRET;
    // If this is not set we want to throw an error as this is required to retrieve the user
    // id from the provided token.
    if (secretKey == null) {
      console.error("JWT_SECRET is not set in the environment variables");
      return res
        .status(500)
        .send("JWT_SECRET is not set in the environment variables");
    }

    if(!req.headers.authorization){
      return res.status(400).json({ message: "No authorization header" }).send();
    }
    
    // Get the token from the request headers
    const token = req.headers.authorization.split(" ")[1];
    // Decode this token with the secret key
    const payload = jwt.decode(token, secretKey, false, jwtAlgorithm);
    // Get the user id from the decoded token payload.
    const userId = payload.id;

    // Check if there is enough free space in the location
    const locationResponse = await axios.get(`${locationUrl}/location/parking-location/${location_id}`);

    if (locationResponse.status != 200) {
      return res.status(500).json({
        message: locationResponse.data['message'] ?? `Could not get location information from location service. ${locationResponse.status}`,
      }).send();
    }

    if (locationResponse.data.free_spaces <= 0) {
      return res.status(500).json({
        message: `No free spaces in ${locationResponse.body.title}`
      }).send();
    }

    /// Get a date object from the start_time string
    const startTime = new Date(start_time);

    if (isDateBeforeToday(startTime)){
      return res.status(400).json({ message: "Start time is before today" });
    }

    // Calculate the end time.
    const endTime = addHours(expires_hours, startTime);

    // Create new booking
    const booking = new Booking({
      user_id: userId,
      location_id,
      start_time: startTime,
      end_time: endTime,
      street_address: locationResponse.data.street_address,
    });
    
    // Decrement free space in location
    try {
      await axios.post(`${locationUrl}/location/parking-location/decrement/${location_id}`,{}, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ADMIN_TOKEN}`
        }
      });
    }
    catch(error){
      return  res.status(500).json({
        message: `Could not decrement free spaces in ${locationResponse.data.title} ${error}`
      });
    }
    
    
    // Save booking   
    const savedBooking = await booking.save();

    const options = {
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    const formattedDate = endTime.toLocaleDateString("en-UK", options);
    const formattedStartTime = startTime.toLocaleTimeString("en-UK", options);

    const title = locationResponse.data['title'];
    const street_address = locationResponse.data['street_address'];
    // Send notification to notifications service
    await axios.post(`${notificationUrl}/notification/create`, {
      user_id: userId,
      title: `Booking Created${title != null ? ` at ${title}` : ''}`,
      description: `You made a booking${street_address != null ? ` at ${street_address}` : ''} starting at ${formattedStartTime}. It expires at ${formattedDate}.`,
    }, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log('created booking: ', savedBooking._id);

    return res.status(200).send(savedBooking);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/extend/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { extend_hours } = req.body;

    if(!req.headers.authorization){
      return res.status(400).json({ message: "No authorization header" }).send();
    }

    // Get the JWT secret from the environment variables
    const secretKey = process.env.JWT_SECRET;
    // If this is not set we want to throw an error as this is required to retrieve the user
    // id from the provided token.
    if (secretKey == null) {
      console.error("JWT_SECRET is not set in the environment variables");
      return res
        .status(500)
        .send("JWT_SECRET is not set in the environment variables");
    }
    // Get the token from the request headers
    const token = req.headers.authorization.split(" ")[1];
    // Decode this token with the secret key
    const payload = jwt.decode(token, secretKey, false, jwtAlgorithm);
    // Get the user id from the decoded token payload.
    const userId = payload.id;

    // Find booking with correct id and user_id
    const booking = await Booking.findOne({ _id: id, user_id: userId });
    if (!booking) {
      return res.status(400).json({ message: "Booking not found" }).send();
    }

    const newEndTime = addHours(extend_hours, booking.end_time);
    booking.end_time = newEndTime;

    console.log('Updated bookings end time.' + booking.end_time);
    const savedBooking = await booking.save();

    // Booking extended notification
    const date = booking.end_time;
    const options = {
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    const formattedDate = date.toLocaleDateString("en-US", options);

    await axios.post(`${notificationUrl}/notification/create`, {
      user_id: userId,
      title: `Booking Extended`,
      description: `Your booking has been extended to ${formattedDate}.`,
    }, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log('extended booking: ', savedBooking._id);

    return res.send(savedBooking);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal server error"  + error});
  }
});

router.get("/getAllBookings", async (req, res) => {
  try {
    // Get the JWT secret from the environment variables
    const secretKey = process.env.JWT_SECRET;
    // If this is not set we want to throw an error as this is required to retrieve the user
    // id from the provided token.
    if (secretKey == null) {
      console.error("JWT_SECRET is not set in the environment variables");
      return res
        .status(500)
        .send("JWT_SECRET is not set in the environment variables");
    }

    if(!req.headers.authorization){
      return res.status(400).json({ message: "No authorization header" }).send();
    }

    // Get the token from the request headers
    const token = req.headers.authorization.split(" ")[1];
    // Decode this token with the secret key
    const payload = jwt.decode(token, secretKey, false, jwtAlgorithm);
    // Get the user id from the decoded token payload.
    const userId = payload.id;

    // Find all bookings for user_id
    const bookings = await Booking.find({ user_id: userId });

    console.log(bookings);

    return res.send(bookings);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error" }).send();
  }
});

// Expired bookings cleanup
setInterval(async () => {
  try {
    // Find all bookings where end_time is less than current time
    const expiredBookings = await Booking.find({
      end_time: { $lt: Date.now() },
    });

    // Delete expired bookings
    await Booking.deleteMany({ end_time: { $lt: Date.now() } });

    // Send notification to notifications service for each deleted booking
    for (let i = 0; i < expiredBookings.length; i++) {
      await axios.post(`${notificationUrl}/notification/create`, {
        user_id: expiredBookings[i].user_id,
        title: `Booking Expired`,
        description: `Your booking has now expired.`,
      }, {
        headers: {
          "Content-Type": "application/json",
        }
      });

      await axios.post(`${locationUrl}/location/parking-location/increment/${location_id}`, {}, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ADMIN_TOKEN}`
        }
      });

      if (incrementResponse.status != 200){
        console.log(`Error incrementing parking location ${expiredBookings[i]._id}`);
      }
    }
  } catch (error) {
    console.log(error);
  }
}, expiredBookingsCheckInterval);

module.exports = router;


/**
 * Returns a date instance with added `hours` of delay.
 *
 * @param {Number} hours - the number of hours to add
 * @param {Date|undefined} date
 *
 * @returns {Date}
 */
function addHours (hours, date = new Date()) {  
  if (typeof hours !== 'number') {
    throw new Error('Invalid "hours" argument')
  }

  if (!(date instanceof Date)) {
    throw new Error('Invalid "date" argument')
  }

  const newDate = new Date(date.valueOf())

  newDate.setHours(date.getHours() + hours)

  return newDate;
}

function isDateBeforeToday(date) {
  return new Date(date.toDateString()) < new Date(new Date().toDateString());
}
