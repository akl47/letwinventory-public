const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { User } = require('../../../models');
const path = require('path');
const dotenv = require('dotenv');

// Load environment-specific .env file
const envFile = process.env.NODE_ENV === 'production'
    ? '.env.production'
    : '.env.development';
dotenv.config({ path: path.join(__dirname, `../../../../${envFile}`) });

const client = new OAuth2Client();

/**
 * Exchange a Google ID token for a Letwinventory JWT token.
 * Used by the Google Workspace Add-on to authenticate.
 */
exports.exchangeToken = async (req, res) => {
    try {
        const { idToken } = req.body;

        if (!idToken) {
            return res.status(400).json({ error: 'idToken is required' });
        }

        // Verify the Google ID token
        // Note: We don't check audience because Apps Script tokens have their own audience
        // (the script's GCP project number), not our OAuth client ID.
        // The token signature is still verified against Google's public keys.
        const ticket = await client.verifyIdToken({
            idToken: idToken
        });

        const payload = ticket.getPayload();

        // Verify the token is from Google
        if (!payload.iss?.includes('accounts.google.com')) {
            return res.status(401).json({ error: 'Invalid token issuer' });
        }

        const email = payload.email;

        if (!email) {
            return res.status(400).json({ error: 'Email not found in token' });
        }

        // Find user by email
        const user = await User.findOne({
            where: { email: email }
        });

        if (!user) {
            return res.status(401).json({ error: 'User not found. Please sign up first.' });
        }

        if (!user.activeFlag) {
            return res.status(401).json({ error: 'User account is not active.' });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' } // Longer expiry for add-on use
        );

        res.json({
            token,
            user: {
                id: user.id,
                displayName: user.displayName,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Add-on token exchange error:', error);

        if (error.message?.includes('Token used too late') ||
            error.message?.includes('Invalid token')) {
            return res.status(401).json({ error: 'Invalid or expired Google token' });
        }

        res.status(500).json({ error: 'Authentication failed' });
    }
};
