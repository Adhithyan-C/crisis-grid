const axios = require('axios');

// Simple keyword-based fallback parser (mirrors the Flutter AiService._simpleParser)
const simpleParser = (query) => {
    const lower = query.toLowerCase();

    let foodType = null;
    if (lower.includes('non-veg') || lower.includes('non veg') || lower.includes('nonveg') ||
        lower.includes('chicken') || lower.includes('mutton') || lower.includes('fish') ||
        lower.includes('egg') || lower.includes('meat') || lower.includes('biryani') ||
        lower.includes('briyani') || lower.includes('mandi') || lower.includes('pulao')) {
        foodType = 'non-veg';
    } else if (lower.includes('veg') || lower.includes('vegetarian')) {
        foodType = 'veg';
    }

    const numberMatch = query.match(/\d+/);
    const quantityPeople = numberMatch ? parseInt(numberMatch[0]) : null;

    const locationMatch = query.match(/(?:near|at|in|around)\s+([a-zA-Z\s]+)(?:\s+for|\s+urgently|$)/i);
    const locationHint = locationMatch ? locationMatch[1].trim() : null;

    const urgency = (lower.includes('urgent') || lower.includes('asap') || lower.includes('immediately'))
        ? 'urgent' : 'normal';

    return { foodType, quantityPeople, locationHint, urgency };
};

// @POST /api/ai/parse — parse natural language to structured filters
const parseQuery = async (req, res) => {
    try {
        const { query } = req.body;

        if (!query || query.trim() === '') {
            return res.json({ filters: { foodType: null, quantityPeople: null, locationHint: null, urgency: null } });
        }

        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        // If no Groq key, use fallback parser
        if (!GROQ_API_KEY || GROQ_API_KEY === 'your_groq_api_key_here') {
            console.warn('⚠️  No Groq API key — using fallback parser');
            return res.json({ filters: simpleParser(query) });
        }

        const systemPrompt = `You are a food donation request parser for an NGO platform. 
Extract structured information from natural language requests about food needs.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "foodType": "veg" or "non-veg" or null,
  "quantityPeople": number or null,
  "locationHint": "location string" or null,
  "urgency": "urgent" or "normal"
}

Rules:
- foodType: detect "veg"/"vegetarian" → "veg", meat/chicken/fish/egg/non-veg → "non-veg", if unclear → null
- quantityPeople: extract any number representing people/servings count
- locationHint: extract area/neighborhood/city name mentioned after "near", "at", "in", "around"
- urgency: "urgent" if words like urgent/asap/immediately/emergency present, else "normal"`;

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: query },
                ],
                temperature: 0.1,
                max_tokens: 200,
            },
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 15000,
            }
        );

        const content = response.data.choices[0].message.content.trim();
        let filters;

        try {
            filters = JSON.parse(content);
        } catch {
            console.warn('⚠️  Groq returned invalid JSON, using fallback parser');
            filters = simpleParser(query);
        }

        // Normalize foodType
        if (filters.foodType) {
            const ft = filters.foodType.toLowerCase().replace(/[_\s]/g, '-');
            if (ft.includes('non')) filters.foodType = 'non-veg';
            else if (ft.includes('veg')) filters.foodType = 'veg';
            else filters.foodType = null;
        }

        res.json({ filters });
    } catch (err) {
        console.error('AI parse error:', err.message);
        // Always fall back gracefully
        const { query } = req.body;
        res.json({ filters: simpleParser(query || '') });
    }
};

// @GET /api/ai/geocode - geocode a location hint
const geocodeHint = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ message: 'Query parameter q is required' });

        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: { q, format: 'json', limit: 1 },
            headers: { 'User-Agent': 'CrisisGrid-App/1.0' },
            timeout: 8000,
        });

        if (response.data && response.data.length > 0) {
            const { lat, lon } = response.data[0];
            res.json({ lat: parseFloat(lat), lng: parseFloat(lon) });
        } else {
            res.status(404).json({ message: 'Location not found' });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = { parseQuery, geocodeHint };
