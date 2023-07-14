const mongoose = require('mongoose');
const MONGODB_URI = process.env.MONGODB_URI;

async function setupDatabase() {

    await mongoose.connect('REDACTED_DB_URL',
        {
            useNewUrlParser: true,
            useUnifiedTopology: true
        }).then(() => {
            console.log('Connection successful');
        }).catch((error) => {
            console.log('Something went wrong..', error);
        })

    return;
}

module.exports = setupDatabase;
