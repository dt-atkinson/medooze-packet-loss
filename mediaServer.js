const SemanticSDP = require('semantic-sdp');
const Medooze = require('medooze-media-server');
const uuidV4 = require('uuid/v4');

const AUDIO_CAPABILITIES = {
    audio: {
        codecs: ['opus'],
        extensions: [
            'urn:ietf:params:rtp-hdrext:ssrc-audio-level',
            'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
        ],
    },
};
const DEFAULT_IP = '127.0.0.1';

class MediaServer {

    constructor() {
        this._producers = {};
        Medooze.setPortRange(1024, 20480);
        this.publicIp = DEFAULT_IP;
    }

    async createProducer(offer) {
        const newUuid = uuidV4();
        console.log(`Producer[${newUuid}]: Creating`);

        // We don't reuse endpoints because it has CPU implications
        const endpoint = Medooze.createEndpoint(this.publicIp);

        // Process the sdp
        const offerObj = SemanticSDP.SDPInfo.parse(offer);

        // Create an DTLS ICE transport
        const transport = endpoint.createTransport(offerObj);

        transport.once('stopped', (event) => {
            console.log(`Producer[${newUuid}]: Transport stopped`);
        });
        transport.once('incomingtrack', (track) => {
            console.log(`Producer[${newUuid}]: Incoming track`);
        });
        transport.on('dtlsstate', (dtlsState) => {
            console.log(`Producer[${newUuid}]: DTLS state '${dtlsState}'`);
        });

        // Set RTP remote properties
        const audio = offerObj.getMedia('audio');
        transport.setRemoteProperties({
            audio,
        });

        // Create local SDP info
        const answerObj = offerObj.answer({
            dtls: transport.getLocalDTLSInfo(),
            ice: transport.getLocalICEInfo(),
            candidates: endpoint.getLocalCandidates(),
            capabilities: AUDIO_CAPABILITIES,
        });

        // Use DTX for bandwidth saving
        const audioOffer = answerObj.getMedia('audio');
        const opus = audioOffer.getCodec('opus');

        // Set RTP local  properties
        transport.setLocalProperties({
            audio: answerObj.getMedia('audio'),
        });

        // Get offered stream info
        const offered = offerObj.getFirstStream();

        // Create the remote stream into the transport
        const incomingStream = transport.createIncomingStream(offered);

        // Store this stream mapped to the UUID so we can fetch it for consumers later
        this._producers[newUuid] = {
            stream: incomingStream,
            transport,
            endpoint,
            mediaInfo: audio,
            consumers: {},
            remoteConsumers: {},
        };

        console.log(`Producer[${newUuid}]: Created`);

        // Return UUID and SDP answer
        return {
            uuid: newUuid,
            sdp: answerObj.toString(),
        };
    }

    createConsumer(producerUuid, offer, internal, externalIdMap) {
        const producer = this._producers[producerUuid];
        if (producer) {
            const newUuid = uuidV4();
            console.log(`Consumer[${newUuid}]: Creating for producer '${producerUuid}'`);

            // Match to same endpoint (more efficient)
            const endpoint = producer.endpoint;
            const offerObj = SemanticSDP.SDPInfo.parse(offer);

            // Create an DTLS ICE transport in that endpoint
            const transport = endpoint.createTransport(offerObj, null);

            // Create local SDP info & add local ice and dtls info
            const answerObj = new SemanticSDP.SDPInfo();
            answerObj.setDTLS(transport.getLocalDTLSInfo());
            answerObj.setICE(transport.getLocalICEInfo());

            // For each local candidate - add candidate to media info
            for (const candidate of endpoint.getLocalCandidates()) {
                answerObj.addCandidate(candidate);
            }

            // Get audio m-line info
            const audioOffer = offerObj.getMedia('audio');
            let audio;
            if (audioOffer) {
                // Create audio media
                audio = new SemanticSDP.MediaInfo(audioOffer.getId(), 'audio');

                const opus = audioOffer.getCodec('opus');
                audio.addCodec(opus);
                audio.setDirection(SemanticSDP.Direction.SENDONLY);

                // Add it to answer
                answerObj.addMedia(audio);
            } else {
                throw new Error(`Consumer[${newUuid}]: No audio offer was given`);
            }

            // Set RTP local  properties
            transport.setLocalProperties({
                audio: answerObj.getMedia('audio'),
            });

            // Create new local stream with only video
            const outgoingStream = transport.createOutgoingStream({
                audio: true,
            });

            // Copy incoming data from the broadcast stream to the local one
            const stream = producer.stream;
            if (!stream) {
                throw new Error(`Consumer[${newUuid}]: '${producerUuid}' has no stream information`);
            }
            outgoingStream.attachTo(stream);

            // Get local stream info and add local stream info it to the answer
            answerObj.addStream(outgoingStream.getStreamInfo());

            transport.on('dtlsstate', (dtlsState) => {
                console.log(`Consumer[${newUuid}]: DTLS state '${dtlsState}'`);
                if (dtlsState === 'closed') {
                    this.destroyConsumer(producerUuid, newUuid, true);
                }
            });

            // Store this consumer as part of the producer object
            producer.consumers[newUuid] = {
                uuid: newUuid,
                transport,
                stream: outgoingStream,
            };
            console.log(`Consumer[${newUuid}]: Created for producer '${producerUuid}'`);

            // Return UUID and SDP answer
            return {
                uuid: newUuid,
                sdp: answerObj.toString(),
            };
        }

        console.log(`Producer '${producerUuid}' doesn't exist to create consumer for`);
        return null;
    }
}


module.exports = new MediaServer();
