// Run this once to create a government account:
// node create-gov-user.js

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('./models/User');

async function createGovUser() {
    await mongoose.connect(process.env.MONGO_URI);

    const existing = await User.findOne({ email: 'gov@crisisgrid.in' });
    if (existing) {
        console.log('✅ Government user already exists:', existing.email);
        process.exit(0);
    }

    const user = await User.create({
        name: 'Government Control',
        email: 'gov@crisisgrid.in',
        password: 'GovAccess2024!',
        role: 'government',
        phone: '',
    });

    console.log('✅ Government user created!');
    console.log('   Email   :', user.email);
    console.log('   Password: GovAccess2024!');
    console.log('   Login at: http://localhost:5173/auth/government');
    process.exit(0);
}

createGovUser().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
