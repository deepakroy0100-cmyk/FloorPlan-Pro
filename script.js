// @ts-nocheck
document.addEventListener('DOMContentLoaded', function() {

    var canvas   = document.getElementById('drawing-canvas');
    var ctx      = canvas.getContext('2d');
    var drawArea = document.getElementById('drawing-area');

    // UI refs
    var coordDisplay  = document.getElementById('coord-display');
    var toolDisplay   = document.getElementById('tool-display');
    var selInfo       = document.getElementById('selection-info');
    var selTooltip    = document.getElementById('selection-tooltip');
    var dragHint      = document.getElementById('drag-hint');
    var selToolbar    = document.getElementById('selection-toolbar');
    var selBadge      = document.getElementById('sel-type-badge');
    var rotateBtn     = document.getElementById('rotateBtn');
    var flipBtn       = document.getElementById('flipBtn');
    var sizeUpBtn     = document.getElementById('sizeUpBtn');
    var sizeDownBtn   = document.getElementById('sizeDownBtn');
    var deleteSelBtn  = document.getElementById('deleteSelBtn');
    var selCloseBtn   = document.getElementById('selCloseBtn');
    var doneSelBtn    = document.getElementById('doneSelBtn');

    // State
    var tool         = 'pencil';
    var isDrawing    = false;
    var startX=0, startY=0, savedImg=null;
    var zoom         = 1;
    var wallColor    = '#1a1a2e';
    var roomColor    = '#f5f0e8';
    var stairsColor  = '#8B6914';
    var doorColor    = '#1a1a2e';
    var windowColor  = '#1a1a2e';
    var wallThick    = 8;
    var showGrid     = true;
    var doSnap       = true;
    var gridSz       = 20;

    canvas.width  = 1200;
    canvas.height = 900;

    var shapes    = [];
    var undoStack = [];
    var redoStack = [];
    var selIdx    = -1;
    var isDrag    = false;
    var dxOff=0, dyOff=0;
    var lastTX=0, lastTY=0, tStart=0;
    var pinchD0=0, pinchZ0=1;
    var nudgeIv=null;
    var NUDGE=4;

    // ── POPUPS ──────────────────────────────────────────────────
    var POPUP_MAP = { home:'home-popup', design:'design-dropdown', add:'add-dropdown',
                      settings:'settings-dropdown', menu:'menu-dropdown', furniture:'furniture-dropdown' };

    function closeAll() {
        Object.values(POPUP_MAP).forEach(function(id){
            var e=document.getElementById(id); if(e) e.classList.remove('active');
        });
        document.body.classList.remove('popup-open');
    }
    function openPopup(key) {
        closeAll();
        var id=POPUP_MAP[key]||key;
        var e=document.getElementById(id);
        if(e){ e.classList.add('active'); document.body.classList.add('popup-open'); }
    }

    // Nav buttons
    document.querySelectorAll('.nav-btn').forEach(function(btn){
        btn.addEventListener('click', function(e){
            e.stopPropagation();
            var panel=this.dataset.panel;
            var el=document.getElementById(POPUP_MAP[panel]);
            var alreadyOpen = el && el.classList.contains('active');
            document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active');});
            this.classList.add('active');
            if (alreadyOpen) { closeAll(); return; }
            openPopup(panel);
        });
    });
    var menuBtn=document.getElementById('menu');
    if(menuBtn) menuBtn.onclick=function(e){e.stopPropagation();openPopup('menu');};

    document.querySelectorAll('.close-btn').forEach(function(b){
        b.addEventListener('click',function(e){e.stopPropagation();closeAll();});
    });

    // Close on outside mousedown (not click — click fires after canvas mousedown too)
    document.addEventListener('mousedown', function(e){
        var anyOpen=Object.values(POPUP_MAP).some(function(id){
            var el=document.getElementById(id); return el&&el.classList.contains('active');
        });
        if(!anyOpen) return;
        // Don't close if clicking inside a popup, nav, menu, selection toolbar, or canvas
        if(e.target.closest('#bottom-bar')) return;
        if(e.target.closest('#menu')) return;
        if(e.target.closest('#selection-toolbar')) return;
        if(e.target === canvas) return;
        var inside=Object.values(POPUP_MAP).some(function(id){
            var el=document.getElementById(id); return el&&el.classList.contains('active')&&el.contains(e.target);
        });
        if(!inside) closeAll();
    });

    // ── TOOL BUTTONS ────────────────────────────────────────────
    var TIPS={
        select:'Click element to select. Drag to move.',
        pencil:'Drag to draw a wall line.',
        rectangle:'Drag to draw a room.',
        door:'Click on a wall → places single door.',
        doubleDoor:'Click on a wall → places double door.',
        window:'Click on a wall → places window.',
        stairs:'Drag to draw stairs (arrow shows direction).',
        eraser:'Click element to erase.',
        text:'Click canvas to add label.'
    };

    document.querySelectorAll('.tool-btn:not(.furn-btn)').forEach(function(btn){
        btn.addEventListener('click', function(e){
            e.stopPropagation();
            document.querySelectorAll('.tool-btn').forEach(function(b){b.classList.remove('active');});
            this.classList.add('active');
            // Parse tool name: doubleDoorTool -> doubleDoor, pencilTool -> pencil
            tool = this.id.replace(/Tool$/, '');
            var lbl=this.querySelector('span:last-child');
            if(toolDisplay) toolDisplay.textContent='Tool: '+(lbl?lbl.textContent:tool);
            var tip=document.getElementById('tool-tip-text');
            if(tip) tip.textContent=TIPS[tool]||'';
            canvas.className = tool==='select'?'select-mode':'';
            selIdx=-1;
            isDrawing=false;
            isDrag=false;
            updateSelUI();
            closeAll();
            redraw();
        });
    });

    // Furniture buttons — place item then auto-switch to Select tool
    document.querySelectorAll('.furn-btn').forEach(function(btn){
        btn.addEventListener('click', function(e){
            e.stopPropagation();
            var ftype=this.dataset.furn;
            var def=FURN_DEF[ftype]||[60,60];
            // Place at centre of current canvas viewport
            var r=canvas.getBoundingClientRect();
            var cx=(r.width/2)*(canvas.width/r.width);
            var cy=(r.height/2)*(canvas.height/r.height);
            var px=snap(cx - def[0]/2);
            var py=snap(cy - def[1]/2);
            saveHist();
            shapes.push({type:'furniture',furn:ftype,x:px,y:py,angle:0});
            selIdx=shapes.length-1;
            // Switch to select so user can immediately move it
            tool='select';
            canvas.className='select-mode';
            document.querySelectorAll('.tool-btn').forEach(function(b){b.classList.remove('active');});
            var selBtn=document.getElementById('selectTool');
            if(selBtn) selBtn.classList.add('active');
            if(toolDisplay) toolDisplay.textContent='Tool: Select';
            isDrawing=false; isDrag=false;
            updateSelUI(); redraw(); closeAll();
        });
    });

    // ── GRID & SNAP ─────────────────────────────────────────────
    function drawGrid(){
        if(!showGrid) return;
        ctx.save(); ctx.strokeStyle='rgba(100,116,139,0.13)'; ctx.lineWidth=0.5;
        for(var gx=0;gx<=canvas.width;gx+=gridSz){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,canvas.height);ctx.stroke();}
        for(var gy=0;gy<=canvas.height;gy+=gridSz){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(canvas.width,gy);ctx.stroke();}
        ctx.restore();
    }
    function snap(v){ return doSnap?Math.round(v/gridSz)*gridSz:v; }

    // ── DRAW: WALL ───────────────────────────────────────────────
    function drawWall(s,sel){
        ctx.save();
        ctx.strokeStyle=sel?'#f59e0b':(s.color||wallColor);
        ctx.lineWidth=(s.thick||wallThick)*(sel?1.3:1);
        ctx.lineCap='round';
        if(sel){ctx.shadowColor='#f59e0b';ctx.shadowBlur=10;}
        ctx.beginPath();ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);ctx.stroke();
        ctx.restore();
        if(sel){[[s.x1,s.y1],[s.x2,s.y2]].forEach(function(p){
            ctx.save();ctx.fillStyle='#f59e0b';ctx.strokeStyle='#fff';ctx.lineWidth=2;
            ctx.beginPath();ctx.arc(p[0],p[1],6,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
        });}
    }

    // ── DRAW: ROOM ───────────────────────────────────────────────
    function drawRoom(s,sel){
        ctx.save();
        ctx.fillStyle=sel?'rgba(245,158,11,0.1)':(s.fill||roomColor);
        ctx.fillRect(s.x,s.y,s.w,s.h);
        ctx.strokeStyle=sel?'#f59e0b':(s.color||wallColor);
        ctx.lineWidth=s.thick||wallThick;
        if(sel){ctx.shadowColor='#f59e0b';ctx.shadowBlur=10;}
        ctx.strokeRect(s.x,s.y,s.w,s.h);
        if(s.label){
            ctx.fillStyle=sel?'#b45309':'#64748b';
            ctx.font='13px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.fillText(s.label,s.x+s.w/2,s.y+s.h/2);
        }
        ctx.restore();
        if(sel) drawRectH(s);
    }
    function drawRectH(s){
        [[s.x,s.y],[s.x+s.w,s.y],[s.x,s.y+s.h],[s.x+s.w,s.y+s.h]].forEach(function(p){
            ctx.save();ctx.fillStyle='#f59e0b';ctx.strokeStyle='#fff';ctx.lineWidth=2;
            ctx.beginPath();ctx.rect(p[0]-5,p[1]-5,10,10);ctx.fill();ctx.stroke();ctx.restore();
        });
    }

    // ── DRAW: SINGLE DOOR ────────────────────────────────────────
    function drawDoor(s,sel){
        var sz=s.size||60, wt=s.wallThick||wallThick;
        var col=sel?'#f59e0b':(s.color||doorColor);
        ctx.save();
        ctx.translate(s.x,s.y);
        ctx.rotate((s.angle||0)*Math.PI/180);
        if(sel){ctx.shadowColor='#f59e0b';ctx.shadowBlur=8;}

        // white gap
        ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=wt+8;ctx.lineCap='butt';
        ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(sz,0);ctx.stroke();ctx.restore();

        ctx.strokeStyle=col;ctx.lineCap='round';

        // jambs
        ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(0,-(wt/2+3));ctx.lineTo(0,(wt/2+3));ctx.stroke();
        ctx.beginPath();ctx.moveTo(sz,-(wt/2+3));ctx.lineTo(sz,(wt/2+3));ctx.stroke();

        // door leaf
        ctx.lineWidth=sel?2.5:2;
        ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(sz,0);ctx.stroke();

        // swing arc — quarter circle only
        ctx.lineWidth=sel?1.8:1.2;ctx.setLineDash([6,4]);
        ctx.beginPath();
        if(s.flipped) ctx.arc(0,0,sz,0,-Math.PI/2,true);
        else          ctx.arc(0,0,sz,0, Math.PI/2,false);
        ctx.stroke();ctx.setLineDash([]);

        // hinge dot
        ctx.fillStyle=col;ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();
        ctx.restore();
        if(sel) dotH(s.x,s.y);
    }

    // ── DRAW: DOUBLE DOOR ────────────────────────────────────────
    function drawDoubleDoor(s,sel){
        var sz=s.size||80, wt=s.wallThick||wallThick;
        var col=sel?'#f59e0b':(s.color||doorColor);
        var half=sz/2;
        ctx.save();
        ctx.translate(s.x,s.y);
        ctx.rotate((s.angle||0)*Math.PI/180);
        if(sel){ctx.shadowColor='#f59e0b';ctx.shadowBlur=8;}

        // white gap
        ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=wt+8;ctx.lineCap='butt';
        ctx.beginPath();ctx.moveTo(-half,0);ctx.lineTo(half,0);ctx.stroke();ctx.restore();

        ctx.strokeStyle=col;ctx.lineCap='round';

        // outer jambs
        ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(-half,-(wt/2+3));ctx.lineTo(-half,(wt/2+3));ctx.stroke();
        ctx.beginPath();ctx.moveTo( half,-(wt/2+3));ctx.lineTo( half,(wt/2+3));ctx.stroke();
        // center split tick
        ctx.beginPath();ctx.moveTo(0,-(wt/2+1));ctx.lineTo(0,(wt/2+1));ctx.stroke();

        // left leaf
        ctx.lineWidth=sel?2.5:2;
        ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-half,0);ctx.stroke();
        // right leaf
        ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(half,0);ctx.stroke();

        // swing arcs
        ctx.lineWidth=sel?1.8:1.2;ctx.setLineDash([6,4]);
        ctx.beginPath();
        if(s.flipped){ctx.arc(-half,0,half,0,-Math.PI/2,true);}
        else          {ctx.arc(-half,0,half,0, Math.PI/2,false);}
        ctx.stroke();
        ctx.beginPath();
        if(s.flipped){ctx.arc(half,0,half,Math.PI,Math.PI+Math.PI/2,false);}
        else          {ctx.arc(half,0,half,Math.PI,Math.PI-Math.PI/2,true);}
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle=col;ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();
        ctx.restore();
        if(sel) dotH(s.x,s.y);
    }

    // ── DRAW: WINDOW ─────────────────────────────────────────────
    function drawWindow(s,sel){
        var sz=s.size||60, wt=s.wallThick||wallThick;
        var col=sel?'#f59e0b':(s.color||windowColor);
        ctx.save();
        ctx.translate(s.x,s.y);
        ctx.rotate((s.angle||0)*Math.PI/180);
        if(sel){ctx.shadowColor='#f59e0b';ctx.shadowBlur=8;}

        ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=wt+8;ctx.lineCap='butt';
        ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(sz,0);ctx.stroke();ctx.restore();

        ctx.strokeStyle=col;ctx.lineCap='round';

        ctx.lineWidth=sel?2:1.8;
        ctx.beginPath();ctx.moveTo(0,-wt/2);ctx.lineTo(sz,-wt/2);ctx.stroke();
        ctx.beginPath();ctx.moveTo(0, wt/2);ctx.lineTo(sz, wt/2);ctx.stroke();
        ctx.beginPath();ctx.moveTo(0,-wt/2);ctx.lineTo(0, wt/2);ctx.stroke();
        ctx.beginPath();ctx.moveTo(sz,-wt/2);ctx.lineTo(sz, wt/2);ctx.stroke();

        ctx.lineWidth=sel?2:1.5;
        ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(sz,0);ctx.stroke();

        ctx.lineWidth=sel?1.2:0.8;
        ctx.beginPath();ctx.moveTo(0,-wt/4);ctx.lineTo(sz,-wt/4);ctx.stroke();
        ctx.beginPath();ctx.moveTo(0, wt/4);ctx.lineTo(sz, wt/4);ctx.stroke();

        ctx.restore();
        if(sel) dotH(s.x,s.y);
    }

    // ── DRAW: STAIRS (direction-aware + rotate support) ──────────
    function drawStairs(s,sel){
        var col=sel?'#f59e0b':(s.color||stairsColor);
        var w=Math.abs(s.w), h=Math.abs(s.h);
        // origin is always top-left regardless of draw direction
        var ox=s.w>=0?s.x:s.x+s.w;
        var oy=s.h>=0?s.y:s.y+s.h;

        ctx.save();
        // Apply rotation around centre if angle set
        if(s.angle){
            ctx.translate(ox+w/2, oy+h/2);
            ctx.rotate(s.angle*Math.PI/180);
            ctx.translate(-w/2, -h/2);
        } else {
            ctx.translate(ox, oy);
        }
        ctx.strokeStyle=col; ctx.lineWidth=sel?2:1.5;
        if(sel){ctx.shadowColor='#f59e0b';ctx.shadowBlur=8;}

        // Outer box
        ctx.beginPath();ctx.rect(0,0,w,h);ctx.stroke();

        var isHoriz = w >= h;  // landscape = steps travel left→right

        if(isHoriz){
            // Vertical step lines — traveller walks left to right
            var steps=Math.max(3,Math.round(w/20));
            var stepW=w/steps;
            for(var i=1;i<steps;i++){
                ctx.beginPath();ctx.moveTo(stepW*i,0);ctx.lineTo(stepW*i,h);ctx.stroke();
            }
            // Arrow: horizontal, left to right
            var ay=h/2, ax1=8, ax2=w-8, aw=8, ah=12;
            ctx.lineCap='round';
            ctx.beginPath();ctx.moveTo(ax1,ay);ctx.lineTo(ax2,ay);ctx.stroke();
            ctx.beginPath();ctx.moveTo(ax2-ah,ay-aw);ctx.lineTo(ax2,ay);ctx.lineTo(ax2-ah,ay+aw);ctx.stroke();
        } else {
            // Horizontal step lines — traveller walks top to bottom
            var steps2=Math.max(3,Math.round(h/20));
            var stepH2=h/steps2;
            for(var j=1;j<steps2;j++){
                ctx.beginPath();ctx.moveTo(0,stepH2*j);ctx.lineTo(w,stepH2*j);ctx.stroke();
            }
            // Arrow: vertical, top to bottom
            var ax=w/2, ay1=8, ay2=h-8, aw2=7, ah2=12;
            ctx.lineCap='round';
            ctx.beginPath();ctx.moveTo(ax,ay1);ctx.lineTo(ax,ay2);ctx.stroke();
            ctx.beginPath();ctx.moveTo(ax-aw2,ay2-ah2);ctx.lineTo(ax,ay2);ctx.lineTo(ax+aw2,ay2-ah2);ctx.stroke();
        }

        ctx.restore();

        // Selection handles at actual corners (before rotation for simplicity)
        if(sel){
            var pts2=[[ox,oy],[ox+w,oy],[ox,oy+h],[ox+w,oy+h]];
            pts2.forEach(function(p){
                ctx.save();ctx.fillStyle='#f59e0b';ctx.strokeStyle='#fff';ctx.lineWidth=2;
                ctx.beginPath();ctx.rect(p[0]-5,p[1]-5,10,10);ctx.fill();ctx.stroke();ctx.restore();
            });
        }
    }

    // ── DRAW: TEXT ───────────────────────────────────────────────
    function drawText(s,sel){
        ctx.save();
        ctx.font=(s.fontSize||14)+'px Inter,sans-serif';
        ctx.fillStyle=sel?'#f59e0b':(s.color||'#1e293b');
        ctx.textAlign='left';ctx.textBaseline='top';
        if(sel){
            ctx.strokeStyle='#f59e0b';ctx.lineWidth=1;ctx.setLineDash([4,2]);
            var mw=ctx.measureText(s.text||'').width;
            ctx.strokeRect(s.x-3,s.y-3,mw+6,(s.fontSize||14)+6);ctx.setLineDash([]);
        }
        ctx.fillText(s.text||'',s.x,s.y);
        ctx.restore();
    }

    // ── DRAW: FURNITURE ──────────────────────────────────────────
    var FURN_DEF = {
        // [w, h, drawFn label]
        'sofa-single':       [80,40],
        'sofa-double':       [120,45],
        'chair':             [40,40],
        'armchair':          [50,50],
        'table-round':       [60,60],
        'table-rect':        [80,50],
        'dining-set':        [100,80],
        'desk':              [90,50],
        'bed-single':        [80,110],
        'bed-double':        [120,110],
        'wardrobe':          [90,45],
        'nightstand':        [35,35],
        'kitchen-counter':   [100,40],
        'sink':              [50,50],
        'stove':             [60,60],
        'fridge':            [55,65],
        'oven':              [50,50],
        'dishwasher':        [50,55],
        'tv':                [100,15],
        'tv-unit':           [100,40],
        'washing-machine':   [55,55],
        'toilet':            [40,60],
        'bathtub':           [70,130],
        'shower':            [70,70],
        'ac':                [90,20],
        'bookshelf':         [80,25]
    };

    function drawFurniture(s, sel){
        var def=FURN_DEF[s.furn]||[60,60];
        var w=def[0], h=def[1];
        var col=sel?'#f59e0b':'#475569';
        var fillCol=sel?'rgba(245,158,11,0.1)':'rgba(226,232,240,0.7)';
        ctx.save();
        ctx.translate(s.x+w/2, s.y+h/2);
        ctx.rotate((s.angle||0)*Math.PI/180);
        ctx.translate(-w/2,-h/2);
        if(sel){ctx.shadowColor='#f59e0b';ctx.shadowBlur=8;}
        ctx.fillStyle=fillCol;
        ctx.strokeStyle=col;
        ctx.lineWidth=sel?2:1.5;

        // Draw based on furniture type
        var f=s.furn;
        if(f==='table-round'){
            ctx.beginPath();ctx.arc(w/2,h/2,Math.min(w,h)/2,0,Math.PI*2);
            ctx.fill();ctx.stroke();
        } else if(f==='bed-single'||f==='bed-double'){
            // bed frame
            ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
            // headboard
            ctx.fillStyle=sel?'rgba(245,158,11,0.3)':'rgba(148,163,184,0.8)';
            ctx.fillRect(0,0,w,18);ctx.strokeRect(0,0,w,18);
            // pillow(s)
            ctx.fillStyle='#fff';
            if(f==='bed-single'){
                ctx.fillRect(10,22,w-20,22);ctx.strokeRect(10,22,w-20,22);
            } else {
                ctx.fillRect(8,22,w/2-12,22);ctx.strokeRect(8,22,w/2-12,22);
                ctx.fillRect(w/2+4,22,w/2-12,22);ctx.strokeRect(w/2+4,22,w/2-12,22);
            }
            // blanket line
            ctx.beginPath();ctx.moveTo(0,52);ctx.lineTo(w,52);ctx.stroke();
        } else if(f==='sofa-single'||f==='sofa-double'){
            // main seat
            ctx.fillRect(0,10,w,h-10);ctx.strokeRect(0,10,w,h-10);
            // backrest
            ctx.fillStyle=sel?'rgba(245,158,11,0.2)':'rgba(148,163,184,0.6)';
            ctx.fillRect(0,0,w,12);ctx.strokeRect(0,0,w,12);
            // armrests
            ctx.fillRect(0,10,8,h-10);ctx.strokeRect(0,10,8,h-10);
            ctx.fillRect(w-8,10,8,h-10);ctx.strokeRect(w-8,10,8,h-10);
            // cushion divisions
            ctx.beginPath();
            if(f==='sofa-double'){ ctx.moveTo(w/2,12);ctx.lineTo(w/2,h); }
            else { ctx.moveTo(w/3,12);ctx.lineTo(w/3,h);ctx.moveTo(2*w/3,12);ctx.lineTo(2*w/3,h); }
            ctx.stroke();
        } else if(f==='chair'){
            ctx.fillRect(0,10,w,h-10);ctx.strokeRect(0,10,w,h-10);
            ctx.fillStyle=sel?'rgba(245,158,11,0.2)':'rgba(148,163,184,0.6)';
            ctx.fillRect(0,0,w,12);ctx.strokeRect(0,0,w,12);
        } else if(f==='armchair'){
            ctx.fillRect(0,12,w,h-12);ctx.strokeRect(0,12,w,h-12);
            ctx.fillStyle=sel?'rgba(245,158,11,0.2)':'rgba(148,163,184,0.6)';
            ctx.fillRect(0,0,w,14);ctx.strokeRect(0,0,w,14);
            ctx.fillStyle=fillCol;
            ctx.fillRect(0,14,10,h-14);ctx.strokeRect(0,14,10,h-14);
            ctx.fillRect(w-10,14,10,h-14);ctx.strokeRect(w-10,14,10,h-14);
        } else if(f==='stove'){
            ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
            // 4 burners
            var bpos=[[w*0.28,h*0.28],[w*0.72,h*0.28],[w*0.28,h*0.72],[w*0.72,h*0.72]];
            bpos.forEach(function(b){
                ctx.beginPath();ctx.arc(b[0],b[1],w*0.14,0,Math.PI*2);ctx.stroke();
                ctx.beginPath();ctx.arc(b[0],b[1],w*0.06,0,Math.PI*2);ctx.fill();ctx.stroke();
            });
        } else if(f==='sink'){
            ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
            ctx.beginPath();ctx.ellipse(w/2,h/2,w/2-6,h/2-6,0,0,Math.PI*2);ctx.stroke();
            ctx.beginPath();ctx.arc(w/2,h/2,4,0,Math.PI*2);ctx.fill();
        } else if(f==='toilet'){
            // tank
            ctx.fillRect(0,0,w,h*0.3);ctx.strokeRect(0,0,w,h*0.3);
            // bowl
            ctx.beginPath();ctx.ellipse(w/2,h*0.65,w/2-2,h*0.35,0,0,Math.PI*2);
            ctx.fill();ctx.stroke();
        } else if(f==='bathtub'){
            ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
            ctx.beginPath();ctx.ellipse(w/2,h*0.55,w/2-8,h*0.38,0,0,Math.PI*2);ctx.stroke();
            ctx.beginPath();ctx.arc(w/2,h*0.15,7,0,Math.PI*2);ctx.stroke(); // faucet
        } else if(f==='shower'){
            ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
            ctx.beginPath();ctx.arc(w/2,h/2,w/2-10,0,Math.PI*2);ctx.stroke();
            ctx.beginPath();ctx.arc(w/2,h/2,5,0,Math.PI*2);ctx.fill();
        } else if(f==='fridge'){
            ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
            ctx.beginPath();ctx.moveTo(0,h*0.35);ctx.lineTo(w,h*0.35);ctx.stroke();
            ctx.beginPath();ctx.arc(w-10,h*0.2,4,0,Math.PI*2);ctx.fill();
            ctx.beginPath();ctx.arc(w-10,h*0.65,4,0,Math.PI*2);ctx.fill();
        } else if(f==='tv'){
            ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
            // screen glare line
            ctx.save();ctx.strokeStyle='rgba(255,255,255,0.4)';ctx.lineWidth=1;
            ctx.beginPath();ctx.moveTo(4,2);ctx.lineTo(w-4,2);ctx.stroke();ctx.restore();
        } else if(f==='washing-machine'){
            ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
            ctx.beginPath();ctx.arc(w/2,h/2,w/2-8,0,Math.PI*2);ctx.stroke();
            ctx.beginPath();ctx.arc(w/2,h/2,w/2-18,0,Math.PI*2);ctx.stroke();
        } else if(f==='ac'){
            ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
            for(var ai=1;ai<4;ai++){
                ctx.beginPath();ctx.moveTo(w*ai/4,2);ctx.lineTo(w*ai/4,h-2);ctx.stroke();
            }
        } else if(f==='dining-set'){
            // table
            ctx.fillRect(w/2-30,h/2-20,60,40);ctx.strokeRect(w/2-30,h/2-20,60,40);
            // chairs around table
            var chairs=[[w/2-15,h/2-38],[w/2-15,h/2+20],[w/2-42,h/2-12],[w/2+22,h/2-12]];
            chairs.forEach(function(c){
                ctx.fillStyle='rgba(148,163,184,0.5)';
                ctx.fillRect(c[0],c[1],30,18);ctx.strokeRect(c[0],c[1],30,18);
                ctx.fillStyle=fillCol;
            });
        } else {
            // generic rectangle with label
            ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
        }

        // Label
        var LABELS={
            'sofa-single':'Sofa','sofa-double':'Sofa 3S','chair':'Chair','armchair':'Armchair',
            'table-round':'Table','table-rect':'Table','dining-set':'Dining','desk':'Desk',
            'bed-single':'Bed','bed-double':'Bed','wardrobe':'Wardrobe','nightstand':'NS',
            'kitchen-counter':'Counter','sink':'Sink','stove':'Stove','fridge':'Fridge',
            'oven':'Oven','dishwasher':'DW','tv':'TV','tv-unit':'TV Unit',
            'washing-machine':'Washer','toilet':'Toilet','bathtub':'Bath',
            'shower':'Shower','ac':'AC','bookshelf':'Shelf'
        };
        ctx.fillStyle=sel?'#92400e':'#334155';
        ctx.font='bold 9px Inter,sans-serif';
        ctx.textAlign='center';ctx.textBaseline='bottom';
        ctx.fillText(LABELS[f]||f, w/2, h-2);

        ctx.restore();
        if(sel){
            // selection handles at corners
            var pts=[[s.x,s.y],[s.x+w,s.y],[s.x,s.y+h],[s.x+w,s.y+h]];
            pts.forEach(function(p){
                ctx.save();ctx.fillStyle='#f59e0b';ctx.strokeStyle='#fff';ctx.lineWidth=2;
                ctx.beginPath();ctx.rect(p[0]-5,p[1]-5,10,10);ctx.fill();ctx.stroke();ctx.restore();
            });
        }
    }

    function dotH(x,y){
        ctx.save();ctx.fillStyle='#f59e0b';ctx.strokeStyle='#fff';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
    }

    // ── REDRAW ───────────────────────────────────────────────────
    function redraw(){
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        drawGrid();
        shapes.forEach(function(sh,i){
            var sel=(i===selIdx);
            if     (sh.type==='wall')      drawWall(sh,sel);
            else if(sh.type==='room')      drawRoom(sh,sel);
            else if(sh.type==='door')      drawDoor(sh,sel);
            else if(sh.type==='doubleDoor')drawDoubleDoor(sh,sel);
            else if(sh.type==='window')    drawWindow(sh,sel);
            else if(sh.type==='stairs')    drawStairs(sh,sel);
            else if(sh.type==='text')      drawText(sh,sel);
            else if(sh.type==='furniture') drawFurniture(sh,sel);
        });
    }

    // ── COORDS ───────────────────────────────────────────────────
    function getPos(cx,cy){
        var r=canvas.getBoundingClientRect();
        return {x:(cx-r.left)*(canvas.width/r.width), y:(cy-r.top)*(canvas.height/r.height)};
    }

    // ── HIT TEST ─────────────────────────────────────────────────
    function ptSeg(px,py,x1,y1,x2,y2){
        var dx=x2-x1,dy=y2-y1,l2=dx*dx+dy*dy;
        if(!l2) return Math.hypot(px-x1,py-y1);
        var t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/l2));
        return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
    }
    function hit(sh,x,y){
        var T=Math.max(12,(sh.thick||wallThick)*1.5+6);
        if(sh.type==='wall') return ptSeg(x,y,sh.x1,sh.y1,sh.x2,sh.y2)<T;
        if(sh.type==='room'||sh.type==='stairs'){
            var mx=Math.min(sh.x,sh.x+sh.w),Mx=Math.max(sh.x,sh.x+sh.w);
            var my=Math.min(sh.y,sh.y+sh.h),My=Math.max(sh.y,sh.y+sh.h);
            var b=(Math.abs(x-mx)<T&&y>=my-T&&y<=My+T)||(Math.abs(x-Mx)<T&&y>=my-T&&y<=My+T)||
                  (Math.abs(y-my)<T&&x>=mx-T&&x<=Mx+T)||(Math.abs(y-My)<T&&x>=mx-T&&x<=Mx+T);
            return b||(sh.type==='room'&&x>mx&&x<Mx&&y>my&&y<My);
        }
        if(sh.type==='door'||sh.type==='doubleDoor'||sh.type==='window')
            return Math.hypot(x-sh.x,y-sh.y)<(sh.size||80)+T;
        if(sh.type==='furniture'){
            var def=FURN_DEF[sh.furn]||[60,60];
            return x>=sh.x-T&&x<=sh.x+def[0]+T&&y>=sh.y-T&&y<=sh.y+def[1]+T;
        }
        if(sh.type==='text'){
            ctx.font=(sh.fontSize||14)+'px Inter,sans-serif';
            var mw=ctx.measureText(sh.text||'').width;
            return x>=sh.x-4&&x<=sh.x+mw+4&&y>=sh.y-4&&y<=sh.y+(sh.fontSize||14)+4;
        }
        return false;
    }
    function findHit(x,y){
        for(var i=shapes.length-1;i>=0;i--) if(hit(shapes[i],x,y)) return i;
        return -1;
    }

    // ── WALL SNAP ────────────────────────────────────────────────
    function nearWall(x,y){
        var R=36,best=null,bd=Infinity;
        shapes.forEach(function(sh){
            if(sh.type==='door'||sh.type==='doubleDoor'||sh.type==='window') return;
            var d=Infinity;
            if(sh.type==='wall') d=ptSeg(x,y,sh.x1,sh.y1,sh.x2,sh.y2);
            if(sh.type==='room') d=Math.min(
                ptSeg(x,y,sh.x,sh.y,sh.x+sh.w,sh.y),
                ptSeg(x,y,sh.x,sh.y+sh.h,sh.x+sh.w,sh.y+sh.h),
                ptSeg(x,y,sh.x,sh.y,sh.x,sh.y+sh.h),
                ptSeg(x,y,sh.x+sh.w,sh.y,sh.x+sh.w,sh.y+sh.h)
            );
            if(d<R&&d<bd){bd=d;best=sh;}
        });
        return best;
    }
    function snapWall(wall,px,py){
        if(!wall) return{x:snap(px),y:snap(py)};
        if(wall.type==='wall'){
            var dx=wall.x2-wall.x1,dy=wall.y2-wall.y1,l2=dx*dx+dy*dy;
            var t=Math.max(0,Math.min(1,((px-wall.x1)*dx+(py-wall.y1)*dy)/l2));
            return{x:wall.x1+t*dx,y:wall.y1+t*dy};
        }
        if(wall.type==='room'){
            var edges=[
                {d:Math.abs(py-wall.y),      x:Math.max(wall.x,Math.min(wall.x+wall.w,px)),y:wall.y},
                {d:Math.abs(py-(wall.y+wall.h)),x:Math.max(wall.x,Math.min(wall.x+wall.w,px)),y:wall.y+wall.h},
                {d:Math.abs(px-wall.x),      x:wall.x,     y:Math.max(wall.y,Math.min(wall.y+wall.h,py))},
                {d:Math.abs(px-(wall.x+wall.w)),x:wall.x+wall.w,y:Math.max(wall.y,Math.min(wall.y+wall.h,py))}
            ];
            edges.sort(function(a,b){return a.d-b.d;});
            return{x:edges[0].x,y:edges[0].y};
        }
        return{x:px,y:py};
    }
    function wAngle(wall,px,py){
        if(wall.type==='wall') return Math.atan2(wall.y2-wall.y1,wall.x2-wall.x1)*180/Math.PI;
        if(wall.type==='room'){
            var d=[{d:Math.abs(py-wall.y),a:0},{d:Math.abs(py-(wall.y+wall.h)),a:0},
                   {d:Math.abs(px-wall.x),a:90},{d:Math.abs(px-(wall.x+wall.w)),a:90}];
            d.sort(function(a,b){return a.d-b.d;});return d[0].a;
        }
        return 0;
    }

    // ── UNDO/REDO ────────────────────────────────────────────────
    function saveHist(){
        undoStack.push(JSON.stringify(shapes));
        if(undoStack.length>80) undoStack.shift();
        redoStack=[];
    }
    function undo(){ if(!undoStack.length)return; redoStack.push(JSON.stringify(shapes)); shapes=JSON.parse(undoStack.pop()); selIdx=-1;updateSelUI();redraw(); }
    function redo(){ if(!redoStack.length)return; undoStack.push(JSON.stringify(shapes)); shapes=JSON.parse(redoStack.pop()); selIdx=-1;updateSelUI();redraw(); }

    // ── SELECTION UI ─────────────────────────────────────────────
    var SEL_NAMES={wall:'Wall',room:'Room',door:'Door',doubleDoor:'Dbl Door',
                   window:'Window',stairs:'Stairs',text:'Label',furniture:'Furniture'};

    function closeSel(){
        if(selInfo) selInfo.textContent='';
        if(dragHint) dragHint.style.display='none';
        if(selToolbar) selToolbar.style.display='none';
    }
    function updateSelUI(){
        if(selIdx>=0&&shapes[selIdx]){
            var t=shapes[selIdx].type;
            if(selInfo) selInfo.textContent=(SEL_NAMES[t]||t)+' selected';
            if(dragHint) dragHint.style.display='flex';
            if(selToolbar) selToolbar.style.display='flex';
            if(selBadge) selBadge.textContent=SEL_NAMES[t]||t;
            var isDW=(t==='door'||t==='doubleDoor'||t==='window');
            var isRot=(isDW||t==='furniture'||t==='stairs');
            if(rotateBtn)  rotateBtn.style.display  =isRot?'flex':'none';
            if(flipBtn)    flipBtn.style.display     =(t==='door'||t==='doubleDoor')?'flex':'none';
            if(sizeUpBtn)  sizeUpBtn.style.display   =isDW?'flex':'none';
            if(sizeDownBtn)sizeDownBtn.style.display =isDW?'flex':'none';
        } else { closeSel(); }
    }

    // ── POINTER DOWN ─────────────────────────────────────────────
    function onDown(cx,cy){
        var p=getPos(cx,cy),x=p.x,y=p.y,sx=snap(x),sy=snap(y);

        if(tool==='select'){
            var h=findHit(x,y);
            if(h>=0){
                selIdx=h;isDrag=true;
                var sh=shapes[h];
                dxOff=x-(sh.x1!==undefined?sh.x1:sh.x);
                dyOff=y-(sh.y1!==undefined?sh.y1:sh.y);
                canvas.style.cursor='grabbing';
            } else { selIdx=-1;isDrag=false; }
            updateSelUI();redraw();return;
        }
        if(tool==='eraser'){
            var he=findHit(x,y);
            if(he>=0){saveHist();shapes.splice(he,1);if(selIdx===he)selIdx=-1;updateSelUI();redraw();}
            return;
        }
        if(tool==='text'){
            var lbl=prompt('Enter label:');
            if(lbl){saveHist();shapes.push({type:'text',x:sx,y:sy,text:lbl,fontSize:14,color:wallColor});redraw();}
            return;
        }
        if(tool==='door'||tool==='doubleDoor'||tool==='window'){
            var wall=nearWall(x,y);
            var wp=snapWall(wall,x,y);
            var ang=wall?wAngle(wall,x,y):0;
            var sz=(tool==='doubleDoor')?80:60;
            saveHist();
            shapes.push({type:tool,x:wp.x,y:wp.y,size:sz,angle:ang,
                color:tool==='window'?windowColor:doorColor,wallThick:wallThick});
            selIdx=shapes.length-1;updateSelUI();redraw();return;
        }
        // Only draw if a drawing tool is active
        if(tool==='pencil'||tool==='rectangle'||tool==='stairs'){
            isDrawing=true;startX=sx;startY=sy;
            savedImg=ctx.getImageData(0,0,canvas.width,canvas.height);
        }
    }

    // ── POINTER MOVE ─────────────────────────────────────────────
    function onMove(cx,cy){
        var p=getPos(cx,cy),x=p.x,y=p.y;
        if(coordDisplay) coordDisplay.textContent='X:'+Math.round(x)+'  Y:'+Math.round(y);

        if(tool==='select'&&isDrag&&selIdx>=0){
            var sh=shapes[selIdx];
            if(sh.type==='wall'){
                var nx=snap(x-dxOff),ny=snap(y-dyOff),ddx=nx-sh.x1,ddy=ny-sh.y1;
                sh.x1=nx;sh.y1=ny;sh.x2+=ddx;sh.y2+=ddy;
            } else if(sh.type==='room'||sh.type==='stairs'){
                sh.x=snap(x-dxOff);sh.y=snap(y-dyOff);
            } else if(sh.type==='door'||sh.type==='doubleDoor'||sh.type==='window'){
                var nxd=x-dxOff,nyd=y-dyOff;
                var nw=nearWall(nxd,nyd);
                if(nw){var sn=snapWall(nw,nxd,nyd);sh.x=sn.x;sh.y=sn.y;sh.angle=wAngle(nw,nxd,nyd);sh.wallThick=wallThick;}
                else{sh.x=snap(nxd);sh.y=snap(nyd);}
            } else {
                sh.x=snap(x-dxOff);sh.y=snap(y-dyOff);
            }
            redraw();return;
        }

        if(!isDrawing)return;
        var sx=snap(x),sy=snap(y);
        ctx.putImageData(savedImg,0,0);
        ctx.save();
        if(tool==='pencil'){
            ctx.strokeStyle=wallColor;ctx.lineWidth=wallThick;ctx.lineCap='round';
            ctx.beginPath();ctx.moveTo(startX,startY);ctx.lineTo(sx,sy);ctx.stroke();
        } else if(tool==='rectangle'){
            ctx.fillStyle=roomColor;ctx.fillRect(startX,startY,sx-startX,sy-startY);
            ctx.strokeStyle=wallColor;ctx.lineWidth=wallThick;
            ctx.strokeRect(startX,startY,sx-startX,sy-startY);
        } else if(tool==='stairs'){
            var dw=sx-startX, dh=sy-startY;
            var absW=Math.abs(dw), absH=Math.abs(dh);
            ctx.strokeStyle=stairsColor;ctx.lineWidth=1.5;
            ctx.strokeRect(startX,startY,dw,dh);
            var isHz=absW>=absH; // horizontal layout when wider than tall
            if(isHz){
                // vertical step lines
                var stepsH=Math.max(3,Math.round(absW/20));
                var stpW=dw/stepsH;
                for(var ii=1;ii<stepsH;ii++){ctx.beginPath();ctx.moveTo(startX+stpW*ii,startY);ctx.lineTo(startX+stpW*ii,sy);ctx.stroke();}
                // horizontal arrow
                var ay0=startY+(sy-startY)/2, ax10=startX+8, ax20=sx-8;
                ctx.lineCap='round';
                ctx.beginPath();ctx.moveTo(ax10,ay0);ctx.lineTo(ax20,ay0);ctx.stroke();
                var arDir=dw>=0?1:-1;
                ctx.beginPath();ctx.moveTo(ax20-arDir*14,ay0-8);ctx.lineTo(ax20,ay0);ctx.lineTo(ax20-arDir*14,ay0+8);ctx.stroke();
            } else {
                // horizontal step lines
                var stepsV=Math.max(3,Math.round(absH/20));
                var stpH=dh/stepsV;
                for(var jj=1;jj<stepsV;jj++){ctx.beginPath();ctx.moveTo(startX,startY+stpH*jj);ctx.lineTo(sx,startY+stpH*jj);ctx.stroke();}
                // vertical arrow
                var ax0=startX+(sx-startX)/2, ay10=startY+8, ay20=sy-8;
                ctx.lineCap='round';
                ctx.beginPath();ctx.moveTo(ax0,ay10);ctx.lineTo(ax0,ay20);ctx.stroke();
                var arDirV=dh>=0?1:-1;
                ctx.beginPath();ctx.moveTo(ax0-8,ay20-arDirV*14);ctx.lineTo(ax0,ay20);ctx.lineTo(ax0+8,ay20-arDirV*14);ctx.stroke();
            }
        }
        ctx.restore();
    }

    // ── POINTER UP ───────────────────────────────────────────────
    function onUp(cx,cy){
        if(tool==='select'){
            if(isDrag){saveHist();isDrag=false;canvas.style.cursor='default';}return;
        }
        if(!isDrawing)return;
        isDrawing=false;
        var p=getPos(cx,cy),sx=snap(p.x),sy=snap(p.y);
        if(tool==='pencil'&&Math.hypot(sx-startX,sy-startY)>4){
            saveHist();shapes.push({type:'wall',x1:startX,y1:startY,x2:sx,y2:sy,color:wallColor,thick:wallThick});
        } else if(tool==='rectangle'&&Math.abs(sx-startX)>8&&Math.abs(sy-startY)>8){
            saveHist();shapes.push({type:'room',x:startX,y:startY,w:sx-startX,h:sy-startY,color:wallColor,fill:roomColor,thick:wallThick});
        } else if(tool==='stairs'&&Math.abs(sx-startX)>8&&Math.abs(sy-startY)>8){
            saveHist();shapes.push({type:'stairs',x:startX,y:startY,w:sx-startX,h:sy-startY,color:stairsColor});
        }
        redraw();
    }

    // ── MOUSE EVENTS ─────────────────────────────────────────────
    canvas.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();onDown(e.clientX,e.clientY);});
    canvas.addEventListener('mousemove',function(e){
        e.preventDefault();onMove(e.clientX,e.clientY);
        if(tool==='select'&&!isDrag){
            var p=getPos(e.clientX,e.clientY),h=findHit(p.x,p.y);
            if(h>=0){
                canvas.style.cursor='pointer';
                if(selTooltip){selTooltip.style.display='block';selTooltip.style.left=(e.clientX+14)+'px';selTooltip.style.top=(e.clientY-10)+'px';
                selTooltip.textContent='Select '+(SEL_NAMES[shapes[h].type]||shapes[h].type);}
            } else {canvas.style.cursor='crosshair';if(selTooltip)selTooltip.style.display='none';}
        } else {if(selTooltip)selTooltip.style.display='none';}
    });
    canvas.addEventListener('mouseup',   function(e){e.preventDefault();onUp(e.clientX,e.clientY);});
    canvas.addEventListener('mouseleave',function(){if(isDrawing){isDrawing=false;redraw();}if(selTooltip)selTooltip.style.display='none';});

    // ── TOUCH EVENTS ─────────────────────────────────────────────
    canvas.addEventListener('touchstart',function(e){
        e.preventDefault();e.stopPropagation();
        if(e.touches.length===2){pinchD0=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);pinchZ0=zoom;isDrawing=false;return;}
        var t=e.touches[0];lastTX=t.clientX;lastTY=t.clientY;tStart=Date.now();onDown(t.clientX,t.clientY);
    },{passive:false});
    canvas.addEventListener('touchmove',function(e){
        e.preventDefault();
        if(e.touches.length===2){var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);setZoom(Math.max(0.4,Math.min(3,pinchZ0*(d/pinchD0))));return;}
        var t=e.touches[0];lastTX=t.clientX;lastTY=t.clientY;onMove(t.clientX,t.clientY);
    },{passive:false});
    canvas.addEventListener('touchend',function(e){
        e.preventDefault();onUp(lastTX,lastTY);
        if(Date.now()-tStart>600&&selIdx>=0&&tool==='select') showDel();
    },{passive:false});

    // ── ZOOM ─────────────────────────────────────────────────────
    function setZoom(lv){zoom=lv;canvas.style.transform='scale('+lv+')';canvas.style.transformOrigin='top left';}
    document.getElementById('zoomIn').onclick=function(){setZoom(Math.min(3,zoom+0.2));closeAll();};
    document.getElementById('zoomOut').onclick=function(){setZoom(Math.max(0.3,zoom-0.2));closeAll();};
    drawArea.addEventListener('wheel',function(e){e.preventDefault();setZoom(Math.max(0.3,Math.min(3,zoom+(e.deltaY>0?-0.1:0.1))));},{passive:false});

    // ── KEYBOARD ─────────────────────────────────────────────────
    document.addEventListener('keydown',function(e){
        if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
        if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}
        if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='Z'))){e.preventDefault();redo();}
        if((e.key==='Delete'||e.key==='Backspace')&&selIdx>=0&&document.activeElement===document.body) showDel();
        if(e.key==='Escape'){selIdx=-1;updateSelUI();redraw();}
    });

    // ── DELETE DIALOG ────────────────────────────────────────────
    function showDel(){var o=document.getElementById('delete-overlay');if(o)o.style.display='flex';}
    var cd=document.getElementById('confirmDelete');
    var cad=document.getElementById('cancelDelete');
    if(cd) cd.onclick=function(){if(selIdx>=0){saveHist();shapes.splice(selIdx,1);selIdx=-1;updateSelUI();redraw();}var o=document.getElementById('delete-overlay');if(o)o.style.display='none';};
    if(cad) cad.onclick=function(){var o=document.getElementById('delete-overlay');if(o)o.style.display='none';};

    // ── SEL TOOLBAR BUTTONS ──────────────────────────────────────
    function nudge(dx,dy){
        if(selIdx<0||!shapes[selIdx])return;
        saveHist();
        var sh=shapes[selIdx];
        if(sh.type==='wall'){sh.x1+=dx;sh.y1+=dy;sh.x2+=dx;sh.y2+=dy;}
        else if(sh.type==='room'||sh.type==='stairs'||sh.type==='furniture'){sh.x+=dx;sh.y+=dy;}
        else {
            var nx=sh.x+dx,ny=sh.y+dy,nw=nearWall(nx,ny);
            if(nw){var sn=snapWall(nw,nx,ny);sh.x=sn.x;sh.y=sn.y;sh.angle=wAngle(nw,nx,ny);sh.wallThick=wallThick;}
            else{sh.x=nx;sh.y=ny;}
        }
        redraw();
    }
    function startNudge(dx,dy){nudge(dx,dy);nudgeIv=setInterval(function(){nudge(dx,dy);},80);}
    function stopNudge(){if(nudgeIv){clearInterval(nudgeIv);nudgeIv=null;}}

    ['moveUp','moveDown','moveLeft','moveRight'].forEach(function(id){
        var el=document.getElementById(id);if(!el)return;
        var map={moveUp:[0,-NUDGE],moveDown:[0,NUDGE],moveLeft:[-NUDGE,0],moveRight:[NUDGE,0]};
        var d=map[id];
        el.addEventListener('click',function(e){e.stopPropagation();nudge(d[0],d[1]);});
        el.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();startNudge(d[0],d[1]);});
        el.addEventListener('touchstart',function(e){e.preventDefault();e.stopPropagation();startNudge(d[0],d[1]);},{passive:false});
        el.addEventListener('mouseup',stopNudge);el.addEventListener('mouseleave',stopNudge);el.addEventListener('touchend',stopNudge);
    });

    if(rotateBtn) rotateBtn.onclick=function(e){
        e.stopPropagation();
        if(selIdx<0||!shapes[selIdx])return;
        saveHist();
        var sh=shapes[selIdx];
        if(sh.type==='stairs'){
            // Swap w and h to rotate direction of travel 90 degrees
            var tmp=sh.w; sh.w=sh.h; sh.h=tmp;
            // Also re-centre so it rotates in place
            var cx=sh.x+Math.abs(sh.w)/2; // NOTE: after swap w is old h
            // Actually keep top-left and just swap dims
        } else {
            sh.angle=((sh.angle||0)+90)%360;
        }
        redraw();
    };
    if(flipBtn)   flipBtn.onclick=function(e){e.stopPropagation();if(selIdx<0)return;saveHist();shapes[selIdx].flipped=!shapes[selIdx].flipped;redraw();};
    if(sizeUpBtn) sizeUpBtn.onclick=function(e){e.stopPropagation();if(selIdx<0)return;saveHist();shapes[selIdx].size=Math.min(200,(shapes[selIdx].size||60)+10);redraw();};
    if(sizeDownBtn)sizeDownBtn.onclick=function(e){e.stopPropagation();if(selIdx<0)return;saveHist();shapes[selIdx].size=Math.max(20,(shapes[selIdx].size||60)-10);redraw();};
    if(deleteSelBtn)deleteSelBtn.onclick=function(e){e.stopPropagation();if(selIdx<0)return;saveHist();shapes.splice(selIdx,1);selIdx=-1;updateSelUI();redraw();};
    if(selCloseBtn)selCloseBtn.addEventListener('click',function(e){e.stopPropagation();selIdx=-1;updateSelUI();redraw();});
    if(doneSelBtn) doneSelBtn.addEventListener('click', function(e){e.stopPropagation();selIdx=-1;updateSelUI();redraw();});
    if(selToolbar) selToolbar.addEventListener('click',function(e){e.stopPropagation();});

    // ── TOOLBAR ──────────────────────────────────────────────────
    var undoBtn=document.getElementById('undoBtn');
    var redoBtn=document.getElementById('redoBtn');
    var clearBtn=document.getElementById('clearBtn');
    var saveBtn=document.getElementById('saveBtn');
    if(undoBtn)  undoBtn.onclick=function(){undo();closeAll();};
    if(redoBtn)  redoBtn.onclick=function(){redo();closeAll();};
    if(clearBtn) clearBtn.onclick=function(){if(confirm('Clear all?')){saveHist();shapes=[];selIdx=-1;updateSelUI();redraw();closeAll();}};
    if(saveBtn)  saveBtn.onclick=function(){var l=document.createElement('a');l.download='floor-plan.png';l.href=canvas.toDataURL();l.click();closeAll();};

    // ── SETTINGS ─────────────────────────────────────────────────
    var apS=document.getElementById('applySettings');
    if(apS) apS.onclick=function(){
        canvas.width=parseInt(document.getElementById('canvasWidth').value)||1200;
        canvas.height=parseInt(document.getElementById('canvasHeight').value)||900;
        wallThick=parseInt(document.getElementById('wallThickness').value)||8;
        redraw();closeAll();
    };
    var gt=document.getElementById('gridToggle');if(gt)gt.onchange=function(e){showGrid=e.target.checked;redraw();};
    var st=document.getElementById('snapToggle');if(st)st.onchange=function(e){doSnap=e.target.checked;};
    var dt=document.getElementById('darkModeToggle');if(dt)dt.onchange=function(e){document.body.classList.toggle('dark-mode',e.target.checked);};

    // ── DESIGN ───────────────────────────────────────────────────
    var apD=document.getElementById('applyDesign');
    if(apD) apD.onclick=function(){
        wallColor=document.getElementById('wallColor').value;
        roomColor=document.getElementById('roomColor').value;
        stairsColor=document.getElementById('stairsColor').value;
        doorColor=document.getElementById('doorColor').value;
        var wcp=document.getElementById('windowColorPicker');if(wcp)windowColor=wcp.value;
        if(selIdx>=0&&shapes[selIdx]){
            shapes[selIdx].color=wallColor;
            if(shapes[selIdx].type==='room')shapes[selIdx].fill=roomColor;
        }
        redraw();closeAll();
    };

    // ── PROJECTS ─────────────────────────────────────────────────
    var projects=[];
    try{projects=JSON.parse(localStorage.getItem('floorProjects')||'[]');}catch(e){projects=[];}
    function renderProjects(){
        var list=document.getElementById('project-list');if(!list)return;
        list.innerHTML='';
        if(!projects.length){list.innerHTML='<p style="color:var(--accent2);font-size:13px;text-align:center;padding:12px">No projects yet</p>';return;}
        projects.forEach(function(p){
            var item=document.createElement('div');item.className='project-item';
            item.innerHTML='<span>'+p.name+'</span><span class="material-icons">chevron_right</span>';
            item.onclick=function(){shapes=JSON.parse(p.data);undoStack=[];redoStack=[];selIdx=-1;updateSelUI();redraw();closeAll();};
            list.appendChild(item);
        });
    }
    renderProjects();
    var npb=document.getElementById('newProjectBtn');
    if(npb) npb.onclick=function(){var n=prompt('Project name:');if(!n)return;projects.push({name:n,data:JSON.stringify(shapes)});try{localStorage.setItem('floorProjects',JSON.stringify(projects));}catch(e){}renderProjects();};

    // ── INIT ─────────────────────────────────────────────────────
    redraw();
    updateSelUI();
});