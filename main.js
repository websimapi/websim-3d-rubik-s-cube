import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TWEEN } from 'three/addons/libs/tween.module.min.js';

// Global variables
let scene, camera, renderer, controls;
let rubiksCube, pieces = [];
const CUBE_SIZE = 1;
const GAP = 0.05;
const ROTATION_DURATION = 500; // ms

// Cube colors (standard configuration)
const colors = {
    front: 0xff0000,  // red
    back: 0xffa500,   // orange
    top: 0xffffff,    // white
    bottom: 0xffff00, // yellow
    right: 0x00ff00,  // green
    left: 0x0000ff    // blue
};

let isRotating = false;
let rotationInProgress = false;

// Initialize the scene
init();
animate();

function init() {
    // Create the scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);

    // Create the camera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    // Create the renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // Add orbit controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);

    // Create the Rubik's Cube
    createRubiksCube();

    // Add event listeners
    window.addEventListener('resize', onWindowResize);
    document.getElementById('shuffle').addEventListener('click', shuffleCube);
    document.getElementById('solve').addEventListener('click', resetCube);
    
    // Add raycaster for cube interaction
    setupRaycaster();
}

function createRubiksCube() {
    rubiksCube = new THREE.Group();
    scene.add(rubiksCube);

    // Create 27 cubes (3x3x3)
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                const piece = createCubePiece(x, y, z);
                pieces.push(piece);
                rubiksCube.add(piece);
            }
        }
    }
}

function createCubePiece(x, y, z) {
    const size = CUBE_SIZE - GAP;
    const geometry = new THREE.BoxGeometry(size, size, size);
    
    // Create materials for each face
    const materials = [];
    
    // Default material (black with white edges)
    const defaultMaterial = new THREE.MeshPhongMaterial({
        color: 0x111111, 
        shininess: 50,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });
    
    for (let i = 0; i < 6; i++) {
        materials.push(defaultMaterial.clone());
    }

    // Apply colors to the faces that are visible
    if (x === 1) materials[0].color.setHex(colors.right); // Right face (+x)
    if (x === -1) materials[1].color.setHex(colors.left); // Left face (-x)
    if (y === 1) materials[2].color.setHex(colors.top); // Top face (+y)
    if (y === -1) materials[3].color.setHex(colors.bottom); // Bottom face (-y)
    if (z === 1) materials[4].color.setHex(colors.front); // Front face (+z)
    if (z === -1) materials[5].color.setHex(colors.back); // Back face (-z)

    // Create cube with materials
    const piece = new THREE.Mesh(geometry, materials);
    
    // Add black edges
    const edgesGeometry = new THREE.EdgesGeometry(geometry);
    const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
    piece.add(edges);
    
    // Set position
    piece.position.set(
        x * (CUBE_SIZE + GAP/2),
        y * (CUBE_SIZE + GAP/2),
        z * (CUBE_SIZE + GAP/2)
    );
    
    // Store original position for reference
    piece.userData = { 
        originalX: x,
        originalY: y,
        originalZ: z,
        currentX: x,
        currentY: y,
        currentZ: z
    };
    
    return piece;
}

function setupRaycaster() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let startPoint = new THREE.Vector2();
    let isDragging = false;
    let selectedPiece = null;
    let selectedNormal = null;
    
    function onMouseDown(event) {
        if (rotationInProgress) return;
        
        // Calculate mouse position in normalized device coordinates
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        startPoint.copy(mouse);
        
        // Update the picking ray with the camera and mouse position
        raycaster.setFromCamera(mouse, camera);
        
        // Calculate objects intersecting the picking ray
        const intersects = raycaster.intersectObjects(pieces);
        
        if (intersects.length > 0) {
            controls.enabled = false;
            isDragging = true;
            selectedPiece = intersects[0].object;
            
            // Get the face normal in world space
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(selectedPiece.matrixWorld);
            selectedNormal = intersects[0].face.normal.clone()
                .applyMatrix3(normalMatrix)
                .normalize();
        }
    }
    
    function onMouseMove(event) {
        if (!isDragging || rotationInProgress) return;
        
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }
    
    function onMouseUp() {
        if (!isDragging || rotationInProgress) return;
        
        const dragVector = new THREE.Vector2().subVectors(mouse, startPoint);
        
        if (dragVector.length() > 0.1 && selectedPiece && selectedNormal) {
            const dragDirection = getDragDirection(dragVector, selectedNormal);
            if (dragDirection) {
                rotateLayer(selectedPiece, selectedNormal, dragDirection);
            }
        }
        
        isDragging = false;
        selectedPiece = null;
        selectedNormal = null;
        controls.enabled = true;
    }
    
    // Determine drag direction based on normal and mouse movement
    function getDragDirection(dragVector, normal) {
        // Convert normal to camera space
        const normalInCamera = normal.clone().project(camera);
        
        // Determine dominant axis of normal in camera space
        let dominantAxis;
        const absX = Math.abs(normalInCamera.x);
        const absY = Math.abs(normalInCamera.y);
        const absZ = Math.abs(normalInCamera.z);
        
        if (absX > absY && absX > absZ) {
            dominantAxis = 'x';
        } else if (absY > absX && absY > absZ) {
            dominantAxis = 'y';
        } else {
            dominantAxis = 'z';
        }
        
        // Check drag direction based on dominant axis
        if (dominantAxis === 'x') {
            return Math.abs(dragVector.y) > Math.abs(dragVector.x) ? 
                (dragVector.y > 0 ? 'up' : 'down') : null;
        } else if (dominantAxis === 'y') {
            return Math.abs(dragVector.x) > Math.abs(dragVector.y) ?
                (dragVector.x > 0 ? 'right' : 'left') : null;
        } else {
            // For Z-facing normals
            if (Math.abs(dragVector.x) > Math.abs(dragVector.y)) {
                return dragVector.x > 0 ? 'right' : 'left';
            } else {
                return dragVector.y > 0 ? 'up' : 'down';
            }
        }
    }
    
    document.addEventListener('mousedown', onMouseDown, false);
    document.addEventListener('mousemove', onMouseMove, false);
    document.addEventListener('mouseup', onMouseUp, false);
    
    // Touch support
    document.addEventListener('touchstart', (event) => {
        event.preventDefault();
        onMouseDown({
            clientX: event.touches[0].clientX,
            clientY: event.touches[0].clientY
        });
    }, false);
    
    document.addEventListener('touchmove', (event) => {
        event.preventDefault();
        onMouseMove({
            clientX: event.touches[0].clientX,
            clientY: event.touches[0].clientY
        });
    }, false);
    
    document.addEventListener('touchend', onMouseUp, false);
}

function rotateLayer(piece, normal, direction) {
    rotationInProgress = true;
    
    // Determine which axis to rotate around based on the normal vector
    let rotationAxis = new THREE.Vector3();
    
    if (Math.abs(normal.x) > 0.9) {
        // Normal points along X axis
        if (direction === 'up') rotationAxis.set(0, 0, 1);
        else if (direction === 'down') rotationAxis.set(0, 0, -1);
        else if (direction === 'left') rotationAxis.set(0, -1, 0);
        else if (direction === 'right') rotationAxis.set(0, 1, 0);
    } else if (Math.abs(normal.y) > 0.9) {
        // Normal points along Y axis
        if (direction === 'up') rotationAxis.set(-1, 0, 0);
        else if (direction === 'down') rotationAxis.set(1, 0, 0);
        else if (direction === 'left') rotationAxis.set(0, 0, -1);
        else if (direction === 'right') rotationAxis.set(0, 0, 1);
    } else if (Math.abs(normal.z) > 0.9) {
        // Normal points along Z axis
        if (direction === 'up') rotationAxis.set(1, 0, 0);
        else if (direction === 'down') rotationAxis.set(-1, 0, 0);
        else if (direction === 'left') rotationAxis.set(0, -1, 0);
        else if (direction === 'right') rotationAxis.set(0, 1, 0);
    }
    
    // Determine which layer to rotate
    let layerPieces = [];
    
    // Normalize normal to find primary axis
    let primaryAxis;
    if (Math.abs(normal.x) > 0.9) primaryAxis = 'x';
    else if (Math.abs(normal.y) > 0.9) primaryAxis = 'y';
    else if (Math.abs(normal.z) > 0.9) primaryAxis = 'z';
    
    // Get the layer value
    const layerValue = {
        x: Math.round(piece.position.x / (CUBE_SIZE + GAP/2)),
        y: Math.round(piece.position.y / (CUBE_SIZE + GAP/2)),
        z: Math.round(piece.position.z / (CUBE_SIZE + GAP/2))
    }[primaryAxis];
    
    // Find all pieces in the same layer
    pieces.forEach(p => {
        const pieceValue = Math.round(p.position[primaryAxis] / (CUBE_SIZE + GAP/2));
        if (pieceValue === layerValue) {
            layerPieces.push(p);
        }
    });
    
    if (layerPieces.length === 0) {
        rotationInProgress = false;
        return;
    }
    
    // Create a rotation group
    const rotationGroup = new THREE.Group();
    scene.add(rotationGroup);
    
    // Move pieces to rotation group
    layerPieces.forEach(p => {
        rubiksCube.remove(p);
        const worldPosition = p.getWorldPosition(new THREE.Vector3());
        const worldQuaternion = p.getWorldQuaternion(new THREE.Quaternion());
        
        rotationGroup.attach(p);
        p.position.copy(worldPosition);
        p.quaternion.copy(worldQuaternion);
    });
    
    // Perform the 90-degree rotation
    const startQuaternion = rotationGroup.quaternion.clone();
    const endQuaternion = startQuaternion.clone();
    const rotationQuat = new THREE.Quaternion().setFromAxisAngle(
        rotationAxis,
        Math.PI / 2
    );
    endQuaternion.multiply(rotationQuat);
    
    // Animate rotation
    new TWEEN.Tween({ t: 0 })
        .to({ t: 1 }, ROTATION_DURATION)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onUpdate(function(obj) {
            const quaternion = new THREE.Quaternion().slerpQuaternions(
                startQuaternion,
                endQuaternion,
                obj.t
            );
            rotationGroup.quaternion.copy(quaternion);
        })
        .onComplete(function() {
            // Move pieces back to the cube
            layerPieces.forEach(p => {
                // Get world position and rotation
                const worldPosition = p.getWorldPosition(new THREE.Vector3());
                const worldQuaternion = p.getWorldQuaternion(new THREE.Quaternion());
                
                rotationGroup.remove(p);
                rubiksCube.add(p);
                
                p.position.copy(worldPosition);
                p.quaternion.copy(worldQuaternion);
                
                // Update cubie position data
                p.userData.currentX = Math.round(worldPosition.x / (CUBE_SIZE + GAP/2));
                p.userData.currentY = Math.round(worldPosition.y / (CUBE_SIZE + GAP/2));
                p.userData.currentZ = Math.round(worldPosition.z / (CUBE_SIZE + GAP/2));
            });
            
            scene.remove(rotationGroup);
            rotationInProgress = false;
        })
        .start();
}

function shuffleCube() {
    if (rotationInProgress) return;
    
    const moves = 20;
    let moveCount = 0;
    
    function performRandomMove() {
        if (moveCount >= moves) return;
        
        const randomPieceIndex = Math.floor(Math.random() * pieces.length);
        const randomPiece = pieces[randomPieceIndex];
        
        // Random face normal
        const axes = ['x', 'y', 'z'];
        const randomAxis = axes[Math.floor(Math.random() * 3)];
        const randomDirection = Math.random() < 0.5 ? -1 : 1;
        
        const normal = new THREE.Vector3();
        normal[randomAxis] = randomDirection;
        
        // Random direction
        const directions = ['up', 'down', 'left', 'right'];
        const randomMoveDirection = directions[Math.floor(Math.random() * 4)];
        
        rotateLayer(randomPiece, normal, randomMoveDirection);
        
        moveCount++;
        
        setTimeout(() => {
            if (!rotationInProgress) {
                performRandomMove();
            } else {
                setTimeout(performRandomMove, 100);
            }
        }, ROTATION_DURATION);
    }
    
    performRandomMove();
}

function resetCube() {
    if (rotationInProgress) return;
    
    // Remove existing cube
    while(rubiksCube.children.length > 0) {
        rubiksCube.remove(rubiksCube.children[0]);
    }
    
    // Clear pieces array
    pieces = [];
    
    // Recreate the cube
    createRubiksCube();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    TWEEN.update();
    controls.update();
    renderer.render(scene, camera);
}

