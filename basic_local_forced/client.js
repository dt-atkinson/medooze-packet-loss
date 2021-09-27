// const API_IP_PORT = "media-orchestrator.test.palringo.aws:80";
const API_IP_PORT = "localhost:8080";

function addVideoForStream(stream, local) {
    //Create new video element
    const video = document.querySelector (local ? "#local" : "#remote");
    //Set same id
    video.streamid = stream.id;
    //Set src stream
    video.srcObject = stream;
    //Set other properties
    video.autoplay = true;
    video.muted = local;
}

let lastPackets = 0;
let lastBytes = 0;
function updateIncomingStats(statsResult) {
    const jitter = document.querySelector("#jitter");
    jitter.innerText = `Jitter: ${statsResult.jitter}`;

    const packetsLost = document.querySelector("#packetsLost");
    packetsLost.innerText = `Packets Lost: ${statsResult.packetsLost}`;

    const packetsReceived = document.querySelector("#packetsReceived");
    packetsReceived.innerText = `Packets Received: ${statsResult.packetsReceived}`;

    const packetsPerSecond = document.querySelector("#packetsPerSecond");
    packetsPerSecond.innerText = `Packets per second: ${statsResult.packetsReceived - lastPackets}`;
    lastPackets = statsResult.packetsReceived;

    const bytesPerSecond = document.querySelector("#bytesPerSecond");
    bytesPerSecond.innerText = `Bytes per second: ${statsResult.bytesReceived - lastBytes}`;
    lastBytes = statsResult.bytesReceived;
}

function httpAsync(type, theUrl, data, callback) {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.onreadystatechange = function() {
        if (xmlHttp.readyState == 4 && xmlHttp.status == 200)
            callback(xmlHttp.responseText);
    };
    xmlHttp.open(type, theUrl, true); // true for asynchronous 
    xmlHttp.setRequestHeader('Content-Type', 'application/json');
    xmlHttp.send(data);
}


//Create PC
const localPc = new RTCPeerConnection();

navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false
})
    .then(function(stream) {
        console.debug("getUserMedia success",stream);

        // Play it
        addVideoForStream(stream,true);

        // Add stream to peer connection
        localPc.addStream(stream);

        // Create new offer
        return localPc.createOffer({
            offerToSendAudio: true,
            offerToSendVideo: false,
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
        });
    })
    .then(function(offer){
        console.debug("createOffer success",offer);
        //We have sdp
        const sdp = offer.sdp;
        //Set it
        localPc.setLocalDescription(offer);
        console.log('Local: ' + sdp);

        const data = {
            sdp,
        };

        httpAsync('POST', `http://${API_IP_PORT}/producer`, JSON.stringify(data), (response) => {
            const parsedObj = JSON.parse(response);
            const sdp = parsedObj.sdp;

            console.log('Remote: ' + sdp);
            localPc.setRemoteDescription(new RTCSessionDescription({
                type:'answer',
                sdp: sdp
            }), function () {
                console.log(`JOINED ${parsedObj.uuid}`);

                remoteConnectionStart(parsedObj.uuid);
            }, function (err) {
                console.error("Error joining",err);
            });
        });
    })
    .catch(function(error){
        console.error("Error",error);
    });

const remoteConnectionStart = (uuid) => {
    console.log("Attempting to link up to uuid: " + uuid);

    let remotePc = new RTCPeerConnection({
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy : "require"
    });

    remotePc.onaddstream = function(event) {
        console.debug("onAddStream",event);

        addVideoForStream(event.stream, false);
        setInterval(async function(){
            const results = await remotePc.getStats();
            for (let result of results.values()) {
                if (result.type === "inbound-rtp") {
                    updateIncomingStats(result);
                }
            }
        }, 1000);
    };

    remotePc.createOffer({
        offerToReceiveVideo: false,
        offerToReceiveAudio: true,
        offerToSendAudio: false,
        offerToSendVideo: false
    }).then(offer => {
        const data = {
            uuid: uuid,
            sdp: offer.sdp
        };
        console.log('Local SDP for recv' + offer.sdp);
        remotePc.setLocalDescription(offer);

        httpAsync('POST', `http://${API_IP_PORT}/consumer`, JSON.stringify(data), (response) => {
            const parsedObj = JSON.parse(response);
            const sdp = parsedObj.sdp;
            console.log('Remote SDP for recv' + sdp);

            remotePc.setRemoteDescription(new RTCSessionDescription({
                    type:'answer',
                    sdp: sdp
                }), function () {
                    console.log("JOINED");
                }, function (err) {
                    console.error("Error joining",err);
                    console.log(sdp);
                }
            );

        });
    });
};
