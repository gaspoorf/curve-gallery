import './style.css'
import * as THREE from 'three'
import { gsap } from 'gsap'
import { Observer } from 'gsap/Observer'

gsap.registerPlugin(Observer)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
document.getElementById('canvas-container').appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xffffff)
scene.fog = new THREE.Fog(0xffffff, 10, 40)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200)


const SCALE = 16 // the curve is defined in Blender units. multiply it by 16 to obtain a consistent size within the scene.
const TEX_VARIANTS = 19 // number of images in the /img folder
const textureLoader = new THREE.TextureLoader()
const textures = loadTextureVariants(TEX_VARIANTS, textureLoader)

const TOTAL = 500 // total number of planes to create along the curve
const CAM_Z = 10 // camera offset along the Z axis
const FOCUS_DIST = 5.5 // the distance from the camera at which planes start to scale up
const MAX_SCALE = 14 // the maximum scale factor for the planes
const Z_GATE = 11 // filters out planes that are too far away in depth to avoid unnecessary calculations

const LATERAL_OFFSET_RANGE = [-1, 1]
const DEPTH_OFFSET_RANGE = [-0.75, 0.75]
const SIZE_RANGE = [0.18, 0.4]



function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function toScaledVector3([x, y, z], scale) {
  return new THREE.Vector3(x * scale, y * scale, z * scale)
}

function loadTextureVariants(count, loader) {
  return Array.from({ length: count }, (_, i) => loader.load(`/img/${i + 1}.webp`))
}

// reconstruct a curve from the exported Blender points
function buildCurve(raw) {
  const points = raw.map(p => toScaledVector3(p, SCALE))
  return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5)
}

// returns position and local normal (nx, ny) at a given point on the curve
function getCurveFrame(curve, t) {
  const pos = curve.getPoint(t)
  const tangent = curve.getTangent(t)
  return { pos, nx: -tangent.y, ny: tangent.x }
}


async function init() {
  const files = ['path1', 'path2', 'path3', 'path4', 'path5']
  const allRaws = await Promise.all(
    files.map(name => fetch(`/paths/${name}.json`).then(r => r.json()))
  )

  let currentPathIndex = 0
  let curve = buildCurve(allRaws[0])

  // convert the focus distance to a t-based threshold relative to the curve length
  let focusTGate = (FOCUS_DIST * 1.5) / curve.getLength()


  function createScaleAnimator(mesh) {
    const proxy = { value: 1 }
    return gsap.quickTo(proxy, 'value', {
      duration: 0.4,
      ease: 'power3.out',
      onUpdate: () => mesh.scale.setScalar(proxy.value),
    })
  }


  const planes = []

  for (let i = 0; i < TOTAL; i++) {
    const t = i / TOTAL // distribute planes evenly along the curve

    const { pos, nx, ny } = getCurveFrame(curve, t) // get position and local normal at this point on the curve

    //random offsets to distribute the objects along the curve
    const lateralOffset = randomBetween(...LATERAL_OFFSET_RANGE) 
    const depthOffset = randomBetween(...DEPTH_OFFSET_RANGE)
    const size = randomBetween(...SIZE_RANGE)


    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: textures[Math.floor(Math.random() * TEX_VARIANTS)], // assign a random texture
        side: THREE.DoubleSide,
      })
    )

    mesh.position.set(
      pos.x + nx * lateralOffset, // lateral offset in the XY plane
      pos.y + ny * lateralOffset, // lateral offset in the XY plane
      pos.z + depthOffset // depth offset
    )

    mesh.userData.t = t
    mesh.userData.lateralOffset = lateralOffset
    mesh.userData.depthOffset = depthOffset
    mesh.userData.setScale = createScaleAnimator(mesh) // attach a pre-built GSAP animator for smooth scale transitions

    planes.push(mesh)
    scene.add(mesh)

  }

  function redistributePlanes(newCurve) {
    planes.forEach((mesh) => {
      const t = mesh.userData.t
      const { pos, nx, ny } = getCurveFrame(newCurve, t)

      gsap.to(mesh.position, {
        x: pos.x + nx * mesh.userData.lateralOffset,
        y: pos.y + ny * mesh.userData.lateralOffset,
        z: pos.z + mesh.userData.depthOffset,
        duration: 1.4,
        ease: 'power3.inOut',
      })
    })
  }


  function computeFocusScale(distance, maxDistance, maxScale) {
    const f = 1 - distance / maxDistance
    return 1 + f ** 3 * (maxScale - 1)
  }


  // proxy object to allow GSAP to animate the camera's t position
  const camProxy = { t: 0 }
  const setCamT = gsap.quickTo(camProxy, 't', { duration: 1, ease: 'power3.out' })
  
  let targetT = 0

  // scroll sensitivity
  const SENSITIVITY = 0.8 / (window.innerHeight * 4)


  Observer.create({
    target: window,
    type: 'wheel,touch,pointer',
    onChange: (self) => {
      if (autoScroll) return
      targetT += self.deltaY * SENSITIVITY
      setCamT(targetT)
    },
  })


  const AUTO_SCROLL_DURATION = 10
  const AUTO_T_PER_SEC = 1 / AUTO_SCROLL_DURATION
  let autoScroll = false

  const camPos = { x: 0, y: 0, z: 0 }

  const scrollToggleBtn = document.getElementById('scroll-toggle')
  scrollToggleBtn.addEventListener('click', () => {
    autoScroll = !autoScroll
    scrollToggleBtn.classList.toggle('active', autoScroll)
    scrollToggleBtn.textContent = autoScroll ? 'Auto' : 'Scroll'
  })


  document.querySelectorAll('.path-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.path)
      if (idx === currentPathIndex) return

      currentPathIndex = idx
      document.querySelectorAll('.path-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')

      const newCurve = buildCurve(allRaws[idx])
      redistributePlanes(newCurve)
      curve = newCurve

      // convert the focus distance into a curve progress threshold (0 to 1)
      focusTGate = (FOCUS_DIST * 1.5) / newCurve.getLength()

      // invert and normalize t to ensure the camera moves forward when scrolling down
      const t = ((1 - camProxy.t) % 1 + 1) % 1
      const target = newCurve.getPoint(t)

      gsap.killTweensOf(camPos)
      gsap.to(camPos, {
        x: target.x,
        y: target.y,
        z: target.z + CAM_Z,
        duration: 1.4,
        ease: 'power3.inOut',
      })
    })

  })


  let lastTime = performance.now()


  function animate() {
    requestAnimationFrame(animate)

    const now = performance.now()
    const delta = (now - lastTime) / 1000
    lastTime = now

    if (autoScroll) {
      targetT += AUTO_T_PER_SEC * delta
      setCamT(targetT)
    }

    
    const t = ((1 - camProxy.t) % 1 + 1) % 1

    const pathPos = curve.getPoint(t)
    if (!gsap.isTweening(camPos)) {
      camPos.x = pathPos.x
      camPos.y = pathPos.y
      camPos.z = pathPos.z + CAM_Z
    }
    camera.position.set(camPos.x, camPos.y, camPos.z)



    for (const plane of planes) {
      const dx = camera.position.x - plane.position.x
      const dy = camera.position.y - plane.position.y
      const dz = Math.abs(camera.position.z - plane.position.z)
      const distXY = Math.sqrt(dx * dx + dy * dy)

      let dt = Math.abs(plane.userData.t - t)
      if (dt > 0.5) {
        dt = 1 - dt
      }

      const isInFocusZone = dt < focusTGate && dz < Z_GATE && distXY < FOCUS_DIST
      const targetScale = isInFocusZone ? computeFocusScale(distXY, FOCUS_DIST, MAX_SCALE) : 1

      plane.userData.setScale(targetScale)
    }

    renderer.render(scene, camera)
  }

  animate();
}


init()


window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
})