const database = require('./db/mongoose');
require('dotenv').config();

const cors = require('cors');
const express = require('express');
const bookingsRouter = require("./routes/bookings_service");

const app = express();
const port = process.env.PORT;
app.use(express.json());
app.use(cors());


(async () => {

  console.log('Setting up database...');
  await database()


  app.use("/bookings", bookingsRouter);

  console.log('Starting server...');
  app.listen(port, function () {
    console.log(`Bookings Microservice is running at http://localhost:${port}`);
  })
})();


