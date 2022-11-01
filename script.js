let cvs = document.getElementById("breakout");
let ctx = cvs.getContext("2d");
let tampil = document.getElementById("tampil");
let tampil2 = document.getElementById("tampil2");
let lose = document.getElementById("show");
let win = document.getElementById("show2");

cvs.style.border = "1px solid black";

let paddle_width = 60;
let paddle_height = 10;

let left =false;
let right = false;

let LIFE = 3;

let SCORE = 0; 

let ball_radius = 8;

let counter = 0;

let count = 0;

let paddle = {
    x : cvs.width/2 - paddle_width/2,
    y : cvs.height  - paddle_height,
    width : paddle_width,
    height: paddle_height,
    dx : 2,
}

let ball = {
    x : cvs.width/2,
    y : paddle.y - ball_radius,
    radius : ball_radius,
    speed : 2.2,
    dx : 1.9 * (Math.random() * 2-1) ,
    dy : -1,
}

let brick = {
    row: 8,
    column: 14,
    width: 20,
    height: 20,
    offSetLeft: 15,
    offSetTop:12,
    marginTop:0,
}

let bricks = [];

function drawPaddle(){
    ctx.fillstyle = "black";
    ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
}

document.addEventListener("keydown", function(e){
    if(e.code == "ArrowLeft"){
        left = true;
    }
    else if(e.code == "ArrowRight"){
        right = true;
    }
})

document.addEventListener("keyup", function(tes){
    if(tes.code == "ArrowLeft"){
        left = false;
    }
    else if(tes.code == "ArrowRight"){
        right = false;
    }
})

function movePaddle(){
    if(right && paddle.x + paddle.width < cvs.width){
        paddle.x += paddle.dx;
    }

    else if(left && paddle.x > 0){
        paddle.x -= paddle.dx;
    }
}

function drawBall(){
    ctx.beginPath();

    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI*2);
    ctx.fill();

    ctx.strokeStyle = "black";
    ctx.stroke();

    ctx.closePath();
}

function moveBall(){
    ball.x += ball.dx;
    ball.y += ball.dy;
}

function ballWallCollision(){
    if(ball.x + ball.radius > cvs.width || ball.x - ball.radius < 0){
        ball.dx = -ball.dx;
    }

    if(ball.y - ball.radius < 0){
        ball.dy = -ball.dy;
    }

    if(ball.y + ball.radius > cvs.height){
        LIFE--;
        resetBall();
        resetPaddle();
    }
}

function resetBall(){
    ball.x = cvs.width/2;
    ball.y = paddle.y - ball_radius;
    ball.dx = 1.9 * (Math.random() * 2-1 );
    ball.dy = -1;
}

function resetPaddle(){
    paddle.x = cvs.width/2 - paddle_width/2;
    paddle.y = cvs.height  - paddle_height;
}

function ballPaddleColision(){
    if(ball.x < paddle.x + paddle.width && ball.x > paddle.x && paddle.y < paddle.y + paddle.height && ball.y > paddle.y){
        let colidePoint = ball.x - (paddle.x + paddle.width/2);
        colidePoint = colidePoint / (paddle.width/2);
        let angle = colidePoint * Math.PI/3;

        ball.dx = ball.speed * Math.sin(angle);
        ball.dy = -ball.speed * Math.cos(angle)
        
    }
}

function createBricks(){
    for (let r = 0; r < brick.row; r++) {
        bricks[r] = [];
        for (let c = 0; c < brick.column; c++) {
            bricks[r][c] = {
                x: c*(brick.offSetLeft + brick.width) + brick.offSetLeft,
                y: r*(brick.offSetTop + brick.height) + brick.offSetTop + brick.marginTop,
                status: true
            }
            
        }
        
    }
}

function drawBricks(){
    for (let r = 0; r < brick.row; r++) {
        for (let c = 0; c < brick.column; c++) {
            let b = bricks[r][c];
            if(bricks[r][c].status == true){
                ctx.fillRect(b.x, b.y, brick.width, brick.height);
            }
            
        }
        
    }
}

function ballBrickCollision(){
    for (let r = 0; r < brick.row; r++) {
        for (let c = 0; c < brick.column; c++) {
            let b = bricks[r][c];
            
            if(b.status == true){
                if(ball.x + ball.radius > b.x && ball.x - ball.radius < b.x + brick.width && ball.y + ball.radius > b.y && ball.y - ball.radius < b.y + brick.height){
                    ball.dy = - ball.dy ;
                    b.status = false;
                    SCORE++;
                }
            }
            
        }
        
    }
}


function draw(){
    drawPaddle();
    drawBall();
    drawBricks();
}

function update(){
    movePaddle();
    moveBall();
    ballWallCollision();
    ballPaddleColision();
    ballBrickCollision();
}

function loop(){
    ctx.clearRect(0,0, cvs.width, cvs.height);

    tampil.innerHTML = `LIFE = ${LIFE}`;
    tampil2.innerHTML = `SCORE = ${SCORE}`;
    
    draw();
    update();
    requestAnimationFrame(loop);

    if(SCORE == brick.row * brick.column){
        count++;
        if(count == 1){    
        }
        else{
            win.style.display = "block";
            tampil.style.display = "none";
            ctx.clearRect(0,0, cvs.width, cvs.height);
            tampil2.innerHTML = `Your Score = ${SCORE}`;
            setInterval(delay, 3000/1);

        }
    }

    if(LIFE == 0 ){
        counter++;
        if(counter == 1){
        }
        else{
            lose.style.display = "block"
            ctx.clearRect(0,0, cvs.width, cvs.height);
            tampil.style.display = "none";
            tampil2.style.display = "none";
            setInterval(delay, 1000);
        }
    }
}

function delay(){
    document.location.reload();
}

createBricks();
loop();

