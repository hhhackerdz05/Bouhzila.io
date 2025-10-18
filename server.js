const { WebSocketServer } = require('ws');
const http = require('http');

// استيراد منطق اللعبة
const Game = require('./game');

// **التحديث:** يجب أن يستمع الخادم على المنفذ المحدد من قِبل بيئة الاستضافة (Render)
const PORT = process.env.PORT || 10000;

// إنشاء خادم HTTP عادي
// هذا الخادم هو ما سيستمع إليه Render
const server = http.createServer((req, res) => {
    // يمكن هنا إضافة منطق بسيط للتحقق من الصحة (Health Check) إذا لزم الأمر
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Server is healthy and running.');
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// إنشاء خادم WebSocket باستخدام خادم HTTP الأساسي
// هذا يضمن أن wss يعمل بشكل صحيح خلف proxy Render
// التحديث الحاسم: إضافة خيار path: '/'
const wss = new WebSocketServer({ server, path: '/' }); 

// إنشاء مثيل للعبة
const game = new Game();

wss.on('connection', (ws, req) => {
    console.log('Client connected from IP:', req.socket.remoteAddress);

    // إضافة اللاعب الجديد إلى اللعبة
    game.addPlayer(ws);

    // معالجة الرسائل الواردة من العميل
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const player = game.players.find(p => p.ws === ws);

            if (!player) return;

            switch (data.type) {
                case 'name':
                    // تحديد اسم اللاعب عند إرساله من العميل
                    if (typeof data.name === 'string' && data.name.trim().length > 0) {
                        player.name = data.name.substring(0, 15); // تحديد حد أقصى للاسم
                        console.log(`Player ${player.id} set name to: ${player.name}`);
                    }
                    break;
                case 'move':
                    // تحديث هدف حركة اللاعب
                    if (typeof data.x === 'number' && typeof data.y === 'number') {
                        player.targetX = data.x;
                        player.targetY = data.y;
                    }
                    break;
                // يمكن إضافة أنواع رسائل أخرى (مثل الانقسام، التسريع) هنا
            }
        } catch (e) {
            console.error('Error processing message:', e.message);
        }
    });

    // معالجة قطع الاتصال
    ws.on('close', () => {
        console.log('Client disconnected.');
        game.removePlayer(ws);
    });
    
    // معالجة الأخطاء
    ws.on('error', (error) => {
        console.error('WebSocket Error:', error.message);
    });
});

// بدء الاستماع على خادم HTTP
server.listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT}`);
    console.log(`WebSocket connections should use WSS at: wss://<your-render-service-name>.onrender.com`);
    
    // تشغيل حلقة تحديث اللعبة
    game.startGameLoop();
});
