const express = require('express');
const cors = require('cors');
const app = express();

const mediaServer = require('./mediaServer');

const PORT = 8080;

app.use(cors({
    origin: 'null'
}));
app.use(express.json());

app.route('/producer').post(async(req, res) => {
    console.log(req.body);

    const reply = await mediaServer.createProducer(req.body.sdp);

    res.json(reply);
});

app.route('/consumer').post(async(req, res) => {
    console.log(req.body);

    const reply = await mediaServer.createConsumer(req.body.uuid, req.body.sdp);

    res.json(reply);
});

const server = app.listen(PORT);
console.log(`Service started on port: ${PORT}`);