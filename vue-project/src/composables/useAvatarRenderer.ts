/**
 * Avatar Renderer composable for Waifu Avatar System
 * Enhanced VRM/VRMA rendering with expressions, animations, and breathing
 */

import { ref, onUnmounted, readonly, type Ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import type { AnimationSequence, AnimationKeyframe, Expression, Visema } from '@/types/waifu-protocol'
import { AvatarState } from '@/types/waifu-protocol'

interface AvatarConfig {
  modelUrl: string
  animationServiceUrl: string
  backgroundGradient?: [string, string]
  baseAnimation?: string  // Default animation to return to, if not specified will use the first available
}

interface BreathingConfig {
  duration: number
  chestExpansion: number
  enabled: boolean
}

const DEFAULT_BREATHING: BreathingConfig = {
  duration: 4.0,
  chestExpansion: 0.02,
  enabled: true  // Enabled - breathing active
}

// Avatar pose states
type AvatarPoseState = 'hello' | 'waiting' | 'attention' | 'thinking' | 'talking'

// Local animation URLs
const ANIMATIONS: Record<string, string> = {
  hello: '/animations/v_hello.vrma',
  base: '/animations/standing.vrma',
  idle: '/animations/waiting-animation.vrma',
  idle2: '/animations/idle2.vrma',
  fix_hair: '/animations/fix_hair.vrma'
}

const BORING_ANIMATIONS = ['idle', 'idle2', 'fix_hair']

// Thinking pose configuration (radians)


const POSE_INTERPOLATION_SPEED = 2.5  // Speed for pose transitions

export function useAvatarRenderer(container: Ref<HTMLElement | undefined>, config: AvatarConfig) {
  // Reactive state
  const avatarState = ref<AvatarState>('loading' as AvatarState)
  const loadingProgress = ref(0)
  const errorMessage = ref<string | null>(null)
  const currentAnimation = ref<string | null>(null)

  // Three.js objects
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let vrm: VRM | null = null
  let mixer: THREE.AnimationMixer | null = null
  let animationId: number | null = null

  // Animation management
  let currentAction: THREE.AnimationAction | null = null
  const loadedAnimations = new Map<string, THREE.AnimationClip>()
  const loadedSequences = new Map<string, AnimationSequence>()

  // State machine management
  const currentPoseState = ref<AvatarPoseState>('hello') // Start with hello
  let boringTimer: number | null = null
  let isBoringAnimationPlaying = false


  // Base rotations for bones (stored when entering attention state)
  const baseBoneRotations: Record<string, { x: number; y: number; z: number }> = {}

  // Expression management
  let expressionQueue: Expression[] = []
  let currentExpressionIndex = 0
  let expressionStartTime = 0
  const currentExpressionValues: Record<string, number> = {}  // Track current expression values for interpolation
  const targetExpressionValues: Record<string, number> = {}   // Track target expression values for interpolation

  // Visema management for lip-sync
  const visemaQueue: Visema[] = []
  let currentVisemaIndex = 0
  const visemaStartTime = 0

  // Breathing configuration
  let breathingConfig: BreathingConfig = { ...DEFAULT_BREATHING }

  // Blink management
  let blinkTimer = 0
  let nextBlinkInterval = 3.0 + Math.random() * 7.0 // Initial interval 3-10s

  // Timing
  const clock = new THREE.Clock()


  /**
   * Initialize the avatar renderer
   */
  const initialize = async (): Promise<void> => {
    try {
      avatarState.value = AvatarState.Loading
      loadingProgress.value = 0
      errorMessage.value = null

      await initializeThreeJS()
      loadingProgress.value = 30

      await loadAvatarModel()
      loadingProgress.value = 70

      await loadLocalAnimations()
      loadingProgress.value = 100

      avatarState.value = AvatarState.Ready

      // Start initial flow
      transitionToHello()

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize avatar'
      handleError(message)
    }
  }

  /**
   * Initialize Three.js scene
   */
  const initializeThreeJS = async (): Promise<void> => {
    if (!container.value) {
      throw new Error('Container element not available')
    }

    // Create scene
    scene = new THREE.Scene()

    // Set background
    if (config.backgroundGradient) {
      const [color1] = config.backgroundGradient
      scene.background = new THREE.Color(color1)
      // TODO: Implement gradient background
    } else {
      scene.background = new THREE.Color(0x212121)
    }

    // Create camera
    camera = new THREE.PerspectiveCamera(
      30,
      container.value.clientWidth / container.value.clientHeight,
      0.1,
      100
    )
    camera.position.set(0, 1.5, 2.5)
    camera.lookAt(0, 1.5, 0)

    // Create renderer
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    })
    renderer.setSize(container.value.clientWidth, container.value.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace

    container.value.appendChild(renderer.domElement)

    // Setup lighting
    setupLighting()

    // Setup resize handler
    window.addEventListener('resize', handleResize)

    // Start render loop
    startRenderLoop()
  }

  /**
   * Setup scene lighting
   */
  const setupLighting = (): void => {
    if (!scene) return

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
    scene.add(ambientLight)

    // Main directional light
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2)
    mainLight.position.set(0.5, 1, 2)
    mainLight.castShadow = true
    mainLight.shadow.mapSize.setScalar(1024)
    scene.add(mainLight)

    // Fill light
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4)
    fillLight.position.set(-0.5, 0.5, 1)
    scene.add(fillLight)

    // Rim light
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3)
    rimLight.position.set(0, 1, -1)
    scene.add(rimLight)
  }

  /**
   * Load avatar VRM model
   */
  const loadAvatarModel = async (): Promise<void> => {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))

    try {
      const gltf = await loader.loadAsync(config.modelUrl)
      vrm = gltf.userData.vrm

      if (!vrm) {
        throw new Error('VRM data not found in model file')
      }

      if (!scene) {
        throw new Error('Scene not initialized')
      }

      // Add to scene
      scene.add(vrm.scene)

      // Position and scale the model
      positionAvatar()

      // Create animation mixer
      mixer = new THREE.AnimationMixer(vrm.scene)

      // Log available expressions for debugging
      if (vrm.expressionManager) {
        const expressions = Object.keys(vrm.expressionManager.expressionMap)
      } else {
      }


    } catch (error) {
      throw new Error(`Failed to load VRM model: ${error}`)
    }
  }

  /**
   * Position and scale the avatar
   */
  const positionAvatar = (): void => {
    if (!vrm || !camera) return

    // Rotate to face camera
    vrm.scene.rotation.set(0, Math.PI, 0)

    // Calculate bounding box
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const size = box.getSize(new THREE.Vector3())

    // Scale to fit nicely
    const maxDim = Math.max(size.x, size.y, size.z)
    const scale = 1.4 / maxDim
    vrm.scene.scale.setScalar(scale)

    // Position at ground level
    vrm.scene.position.set(0, -size.y * scale * 0.17, 0)

    // Adjust camera for head level
    const eyeHeight = size.y * scale * 0.68
    camera.position.set(0, eyeHeight, 1.7) //  - serca, + lejos
    camera.lookAt(0, eyeHeight * 0.95, 0)
  }

  /**
   * Load all local animations
   */
  const loadLocalAnimations = async (): Promise<void> => {
    for (const [name, url] of Object.entries(ANIMATIONS)) {
      const sequence: AnimationSequence = {
        sequence: name,
        vrma_file: url,
        breathing: true,
        delay: 0,
        temporary: false
      }

      const keyframeName = extractKeyframeName(url)
      if (!loadedAnimations.has(keyframeName)) {
        await loadVRMAFile(keyframeName, url)
      }
      loadedSequences.set(name, sequence)
    }
  }

  /**
   * State Transition: HELLO
   * Initial state, plays hello animation once then goes to Waiting
   */
  const transitionToHello = async (): Promise<void> => {
    currentPoseState.value = 'hello'
    stopBoringTimer()

    // Play hello animation
    await playAnimationClean('hello', false)

    // Setup listener for finish (using the duration from the clip)
    const sequence = loadedSequences.get('hello')
    if (sequence?.vrma_file) {
      const keyframeName = extractKeyframeName(sequence.vrma_file)
      const clip = loadedAnimations.get(keyframeName)
      if (clip) {
        setTimeout(() => {
          if (currentPoseState.value === 'hello') {
            transitionToWaiting()
          }
        }, clip.duration * 1000)
      }
    }
  }

  /**
   * State Transition: WAITING
   * Idle state with breathing and random "boring" animations
   */
  const transitionToWaiting = (): void => {
    if (currentPoseState.value === 'waiting') return
    currentPoseState.value = 'waiting'

    // Resume breathing/idle loop (random boring animations)
    startBoringTimer()

    // Ensure we are in a neutral idle state (Base Pose A)
    playAnimationClean('base', true)
  }

  /**
   * Start the timer for boring animations
   */
  const startBoringTimer = (): void => {
    stopBoringTimer()

    boringTimer = setTimeout(() => {
      triggerBoringAnimation()
    }, 10000) // 10 seconds
  }

  const stopBoringTimer = (): void => {
    if (boringTimer) {
      clearTimeout(boringTimer)
      boringTimer = null
    }
  }

  const triggerBoringAnimation = async (): Promise<void> => {
    if (currentPoseState.value !== 'waiting') return

    const randomAnim = BORING_ANIMATIONS[Math.floor(Math.random() * BORING_ANIMATIONS.length)]
    isBoringAnimationPlaying = true

    await playAnimationClean(randomAnim, false)

    // Calculate duration to reset
    const sequence = loadedSequences.get(randomAnim)
    if (sequence?.vrma_file) {
      const keyframeName = extractKeyframeName(sequence.vrma_file)
      const clip = loadedAnimations.get(keyframeName)
      if (clip) {
        setTimeout(() => {
          isBoringAnimationPlaying = false
          // Return to base idle
          if (currentPoseState.value === 'waiting') {
            playAnimationClean('base', true)
            startBoringTimer() // Restart timer
          }
        }, clip.duration * 1000)
      }
    }
  }

  /**
   * Transition to attention state (user started speaking)
   */
  const transitionToAttention = async (): Promise<void> => {
    performAttentionTransition()
  }

  const performAttentionTransition = (): void => {
    if (currentPoseState.value === 'attention' || currentPoseState.value === 'thinking' || currentPoseState.value === 'talking') {
      return
    }

    currentPoseState.value = 'attention'
    stopBoringTimer()

    // Ensure base animation is playing (standing)
    playAnimationClean('base', true)

    // Capture base rotations for manual manipulation
    storeBoneBaseRotations()

    // Apply smiling expression (VRM 'happy')
    if (vrm?.expressionManager) {
      vrm.expressionManager.setValue('happy', 1.0)
    }
  }




  /**
   * Load animation from service
   */
  const loadAnimation = async (animationName: string): Promise<void> => {
    // TEMPORARILY FORCE RELOAD FOR TESTING - Remove cache check
    // if (loadedSequences.has(animationName)) {
    //   return
    // }

    try {
      // Get animation data from service
      const response = await fetch(`${config.animationServiceUrl}/sequence/${animationName}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch animation: ${animationName}`)
      }

      const animationData: AnimationSequence = await response.json()


      // 🔍 LOG ESPECIAL PARA IDLE
      if (animationName === 'idle') {
        console.group('🏠 IDLE Animation Deep Dive')
        console.groupEnd()
      }

      // Handle keyframes format (multiple VRMA files)
      if (animationData.keyframes) {

        for (const keyframe of animationData.keyframes) {
          const vrmaUrl = keyframe.vrma
          const keyframeName = extractKeyframeName(vrmaUrl)

          if (!loadedAnimations.has(keyframeName)) {
            await loadVRMAFile(keyframeName, vrmaUrl)
          }
        }
      }
      // Handle single VRMA file format
      else if (animationData.vrma_file) {
        const keyframeName = extractKeyframeName(animationData.vrma_file)

        if (!loadedAnimations.has(keyframeName)) {
          await loadVRMAFile(keyframeName, animationData.vrma_file)
        }
      }
      else {
        throw new Error(`Animation ${animationName} has neither keyframes nor vrma_file`)
      }

      // Store the sequence data
      loadedSequences.set(animationName, animationData)


    } catch (error) {
      console.error(`Failed to load animation ${animationName}:`, error)
      throw error
    }
  }

  /**
   * Extract keyframe name from VRMA URL
   */
  const extractKeyframeName = (vrmaUrl: string): string => {
    const filename = vrmaUrl.split('/').pop() || vrmaUrl
    return filename.replace('.vrma', '')
  }

  /**
   * Load VRMA animation file
   */
  const loadVRMAFile = async (name: string, vrmaUrl: string): Promise<void> => {
    if (!vrm || !mixer) return

    const loader = new GLTFLoader()
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

    try {
      const gltf = await loader.loadAsync(vrmaUrl)

      if (gltf.userData.vrmAnimations && gltf.userData.vrmAnimations.length > 0) {
        const vrmAnimation = gltf.userData.vrmAnimations[0]



        const clip = createVRMAnimationClip(vrmAnimation, vrm)

        if (clip) {


          loadedAnimations.set(name, clip)
        }
      }

    } catch (error) {
      console.error(`Failed to load VRMA file ${vrmaUrl}:`, error)
      throw error
    }
  }

  /**
   * Clean animation player - replaces the complex playAnimation
   */
  const playAnimationClean = async (animationName: string, isIdle: boolean = false, crossfadeDuration: number = 1.5): Promise<void> => {

    if (!mixer) {
      return
    }

    try {
      // Load animation if not loaded
      if (!loadedSequences.has(animationName)) {
        await loadAnimation(animationName)
      }

      const sequence = loadedSequences.get(animationName)
      if (!sequence) {
        console.error(`❌ Animation ${animationName} not found`)
        return
      }

      // Handle specific animations (from webhook)
      if (!isIdle) {
        // currentAnimationState = 'specific' // No longer used
        stopBoringTimer() // Stop idle rotation
      }

      // Play the animation
      await playAnimationSequence(sequence, animationName, isIdle, crossfadeDuration)

    } catch (error) {
      console.error(`❌ Error playing animation ${animationName}:`, error)
    }
  }

  /**
   * Play animation sequence with proper cleanup
   */
  const playAnimationSequence = async (sequence: AnimationSequence, animationName: string, isIdle: boolean, crossfadeDuration: number): Promise<void> => {
    // Handle single VRMA file format
    if (sequence.vrma_file) {
      await playSingleVRMA(sequence.vrma_file, animationName, isIdle, crossfadeDuration)
    }
    // Handle keyframes format (if needed)
    else if (sequence.keyframes && sequence.keyframes.length > 0) {
    }
    else {
      console.error(`❌ Unknown animation format for ${animationName}`)
    }
  }

  /**
   * Play single VRMA file with proper state management
   */
  const playSingleVRMA = async (vrmaUrl: string, animationName: string, isIdle: boolean, crossfadeDuration: number): Promise<void> => {
    if (!mixer) return

    const keyframeName = extractKeyframeName(vrmaUrl)
    const clip = loadedAnimations.get(keyframeName)
    if (!clip) {
      console.error(`❌ Clip not found for ${keyframeName} from ${vrmaUrl}`)
      return
    }

    const newAction = mixer.clipAction(clip)

    // Configure animation based on type
    if (isIdle) {
      newAction.setLoop(THREE.LoopRepeat, Infinity)
      newAction.clampWhenFinished = false
    } else {
      // Specific animations play once
      newAction.setLoop(THREE.LoopOnce, 1)
      newAction.clampWhenFinished = true
    }

    // Setup and play
    newAction.reset()
    newAction.setEffectiveWeight(1.0)
    newAction.setEffectiveTimeScale(1.0)

    // Crossfade from current action
    if (currentAction && currentAction !== newAction) {
      newAction.play()
      currentAction.crossFadeTo(newAction, crossfadeDuration, false)
    } else {
      newAction.play()
    }

    currentAction = newAction
    currentAnimation.value = animationName
  }

  /**
   * Main animation function - now uses clean system
   */
  const playAnimation = async (animationName: string, crossfadeDuration: number = 0.8): Promise<void> => {
    // Only allow manual plays in appropriate states if needed, but primarily internal now
    const isLoop = animationName === 'idle' || animationName === 'waiting-animation'
    await playAnimationClean(animationName, isLoop, crossfadeDuration)
  }


  /**
   * Play expressions sequence
   */
  const playExpressions = (expressions: Expression[]): void => {
    if (!vrm?.expressionManager) {
      console.warn('Expression manager not available')
      return
    }

    expressionQueue = [...expressions].sort((a, b) => a.tiempo - b.tiempo)
    currentExpressionIndex = 0
    expressionStartTime = clock.getElapsedTime()

    // Initialize interpolation values for expressions
    // Get all unique expressions mentioned in the queue
    const allExpressions = [...new Set(expressions.map(e => e.expresion))]
    allExpressions.forEach(expressionName => {
      currentExpressionValues[expressionName] = 0
      targetExpressionValues[expressionName] = 0
    })

  }

  /**
   * Play visemas sequence with smooth transitions (like AvatarDemo.vue)
   */
  const playVisemas = (visemas: Visema[]): void => {
    if (!vrm?.expressionManager) {
      console.warn('Expression manager not available for visemas')
      return
    }


    // Launch smooth visema animation asynchronously
    animateVisemasSmooth(visemas)
  }

  /**
   * Animate visemas with smooth transitions (async version like AvatarDemo.vue)
   */
  const animateVisemasSmooth = async (visemas: Visema[]): Promise<void> => {
    if (!vrm?.expressionManager) return

    const startTime = Date.now()

    for (const visemaData of visemas) {
      const targetTime = visemaData.tiempo * 1000
      const currentTime = Date.now() - startTime

      if (targetTime > currentTime) {
        await new Promise(resolve => setTimeout(resolve, targetTime - currentTime))
      }

      const visemaName = visemaData.visema
      if (vrm.expressionManager.expressionMap[visemaName]) {
        // Smooth transition like AvatarDemo.vue
        await smoothTransition(visemaName, 0.75, 150) // Fade in quickly

        // Auto fade out after brief hold
        setTimeout(async () => {
          if (vrm?.expressionManager) {
            await smoothTransition(visemaName, 0.0, 150) // Fade out
          }
        }, 200)

      } else {
        console.warn(`👄 ⚠️ Visema NOT found in VRM: ${visemaName} at ${visemaData.tiempo}s`)
      }
    }

  }

  /**
   * Smooth transition function for expressions/visemas
   */
  const smoothTransition = async (expressionName: string, targetValue: number, durationMs: number): Promise<void> => {
    if (!vrm?.expressionManager) return

    const startValue = vrm.expressionManager.getValue(expressionName) || 0
    const startTime = Date.now()

    return new Promise<void>((resolve) => {
      const animate = () => {
        const elapsed = Date.now() - startTime
        const progress = Math.min(elapsed / durationMs, 1)

        // Ease out cubic for smoother transition
        const easeProgress = 1 - Math.pow(1 - progress, 3)
        const currentValue = startValue + (targetValue - startValue) * easeProgress

        if (vrm?.expressionManager) {
          vrm.expressionManager.setValue(expressionName, currentValue)
        }

        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          resolve()
        }
      }

      requestAnimationFrame(animate)
    })
  }

  /**
   * Update expressions based on timeline with smooth interpolation (DISABLED)
   */
  const _updateExpressions = (): void => {
    if (!vrm?.expressionManager || expressionQueue.length === 0) return

    const currentTime = clock.getElapsedTime() - expressionStartTime

    // Process next expressions in queue to set targets
    while (currentExpressionIndex < expressionQueue.length) {
      const expression = expressionQueue[currentExpressionIndex]

      if (currentTime >= expression.tiempo) {
        // Check if expression exists in VRM
        const expressionExists = vrm.expressionManager.expressionMap.hasOwnProperty(expression.expresion)

        if (expressionExists) {
          // Set target value for interpolation
          targetExpressionValues[expression.expresion] = expression.intensidad
        } else {
          console.warn(`😊 ⚠️ Expression NOT found in VRM: ${expression.expresion} at ${expression.tiempo}s`)
        }
        currentExpressionIndex++
      } else {
        break
      }
    }

    // Apply smooth interpolation to all expression values
    if (vrm?.expressionManager) {
      const deltaTime = clock.getDelta()
      const interpolationSpeed = 6.0 // Slightly slower than visemes for more natural emotions

      // Get all expressions that have values (current or target)
      const allExpressionNames = new Set([
        ...Object.keys(currentExpressionValues),
        ...Object.keys(targetExpressionValues)
      ])

      allExpressionNames.forEach(expressionName => {
        // SKIP VISEMA EXPRESSIONS - Don't let expressions overwrite lip-sync
        const visemaExpressions = ['ou', 'ee', 'oh', 'neutral', 'aa', 'ih']
        if (visemaExpressions.includes(expressionName)) {
          return
        }

        const currentValue = currentExpressionValues[expressionName] || 0
        const targetValue = targetExpressionValues[expressionName] || 0

        // Smooth interpolation using lerp
        const newValue = currentValue + (targetValue - currentValue) * interpolationSpeed * deltaTime

        // Update current value and apply to VRM
        currentExpressionValues[expressionName] = newValue

        // Only apply if expression exists in VRM and it's not a viseme
        if (vrm!.expressionManager!.expressionMap.hasOwnProperty(expressionName)) {
          vrm!.expressionManager!.setValue(expressionName, newValue)
        }
      })
    }
  }

  /**
   * Update visemas based on timeline for lip-sync with smooth interpolation (DISABLED)
   */
  const _updateVisemas = (): void => {
    if (!vrm?.expressionManager || visemaQueue.length === 0) return

    const currentTime = clock.getElapsedTime() - visemaStartTime

    // DEBUG: Log timing info every few seconds
    if (Math.floor(currentTime * 2) !== Math.floor((currentTime - clock.getDelta()) * 2)) {
    }

    // Process next visemas in queue to set targets
    while (currentVisemaIndex < visemaQueue.length) {
      const visema = visemaQueue[currentVisemaIndex]

      if (currentTime >= visema.tiempo) {
        const visemaExists = vrm.expressionManager.expressionMap.hasOwnProperty(visema.visema)

        if (visemaExists) {
          // DIRECT APPLICATION - NO INTERPOLATION
          const availableVisemas = ['ou', 'ee', 'oh', 'neutral']

          // Reset all visemas to 0 directly
          availableVisemas.forEach(v => {
            vrm!.expressionManager!.setValue(v, 0)
          })

          // Apply current visema directly
          const intensity = 0.7  // Full intensity for clear lip movements
          vrm!.expressionManager!.setValue(visema.visema, intensity)

        } else {
          console.warn(`👄 ⚠️ Visema NOT found in VRM: ${visema.visema} at ${visema.tiempo}s`)
        }
        currentVisemaIndex++
      } else {
        break
      }
    }

    // INTERPOLATION DISABLED - USING DIRECT APPLICATION ONLY
  }

  /**
   * Apply breathing animation (improved version)
   */
  const updateBreathing = (): void => {
    // Only breathe in waiting and attention states
    if (!vrm?.humanoid || !breathingConfig.enabled || (currentPoseState.value !== 'waiting' && currentPoseState.value !== 'attention')) return

    const time = clock.getElapsedTime()
    const { duration, chestExpansion } = breathingConfig

    // Smooth sinusoidal breathing cycle
    const breathCycle = Math.sin(time * (Math.PI * 2) / duration)

    // Apply to chest bone
    const chestBone = vrm.humanoid.humanBones.chest?.node
    if (chestBone) {
      if (chestBone.userData.baseRotationX === undefined) {
        chestBone.userData.baseRotationX = chestBone.rotation.x
      }
      chestBone.rotation.x = chestBone.userData.baseRotationX + (breathCycle * chestExpansion)
    }

    // Apply complementary movement to spine
    const spineBone = vrm.humanoid.humanBones.spine?.node
    if (spineBone) {
      if (spineBone.userData.baseRotationX === undefined) {
        spineBone.userData.baseRotationX = spineBone.rotation.x
      }
      spineBone.rotation.x = spineBone.userData.baseRotationX + (breathCycle * chestExpansion * 0.4)
    }
  }

  /**
   * Update blinking logic
   */
  const updateBlinking = (deltaTime: number): void => {
    if (!vrm?.expressionManager) return

    blinkTimer += deltaTime

    if (blinkTimer >= nextBlinkInterval) {
      // Trigger blink
      blinkTimer = 0
      nextBlinkInterval = 3.0 + Math.random() * 7.0 // Random interval 3-10s

      // Perform blink
      performBlink()
    }
  }

  const performBlink = async (): Promise<void> => {
    // Blink close (0 -> 1)
    await smoothTransition('blink', 1.0, 100)

    // Hold briefly
    setTimeout(async () => {
      // Blink open (1 -> 0)
      await smoothTransition('blink', 0.0, 100)
    }, 100)
  }



  // Thinking pose configuration (radians)
  // Directions: Up-Left, Up-Right, Down-Left, Down-Right, Left, Right
  interface ThinkingPose {
    headRotationX: number
    headRotationY: number
    headRotationZ: number
    eyeRotationX: number
    eyeRotationY: number
    dwellTime: number // How long to stay in this pose
    speed: number // Interpolation speed for this movement
  }

  const generateRandomThinkingPose = (): ThinkingPose => {
    // Randomly select direction
    const directions = ['UL', 'UR', 'DL', 'DR', 'L', 'R']
    const dir = directions[Math.floor(Math.random() * directions.length)]

    // Base intensity
    // Eyes reduced to 2/3 as requested
    const headH = 0.15 + Math.random() * 0.1
    const headV = 0.10 + Math.random() * 0.05
    const eyeH = (0.3 + Math.random() * 0.1) * 0.66
    const eyeV = (0.1 + Math.random() * 0.05) * 0.66

    // Tilt calculations (natural head tilt follows gaze)
    // Looking Left -> Tilt Left (Z-)
    // Looking Right -> Tilt Right (Z+)
    const tilt = 0.05 + Math.random() * 0.05

    let pose: ThinkingPose = {
      headRotationX: 0, headRotationY: 0, headRotationZ: 0,
      eyeRotationX: 0, eyeRotationY: 0,
      dwellTime: 500 + Math.random() * 3500, // 0.5s - 4.0s random interval
      speed: 0.5 + Math.random() * 2.5 // Random speed 0.5 - 3.0
    }

    switch (dir) {
      case 'UL': // Up Left
        pose.headRotationX = -headV
        pose.headRotationY = headH
        pose.headRotationZ = -tilt
        pose.eyeRotationX = -eyeV
        pose.eyeRotationY = eyeH
        break
      case 'UR': // Up Right
        pose.headRotationX = -headV
        pose.headRotationY = -headH
        pose.headRotationZ = tilt
        pose.eyeRotationX = -eyeV
        pose.eyeRotationY = -eyeH
        break
      case 'DL': // Down Left
        pose.headRotationX = headV
        pose.headRotationY = headH
        pose.headRotationZ = -tilt
        pose.eyeRotationX = eyeV
        pose.eyeRotationY = eyeH
        break
      case 'DR': // Down Right
        pose.headRotationX = headV
        pose.headRotationY = -headH
        pose.headRotationZ = tilt
        pose.eyeRotationX = eyeV
        pose.eyeRotationY = -eyeH
        break
      case 'L': // Left
        pose.headRotationX = (Math.random() - 0.5) * 0.05 // Slight random V
        pose.headRotationY = headH * 1.2
        pose.headRotationZ = -tilt
        pose.eyeRotationX = 0
        pose.eyeRotationY = eyeH * 1.2
        break
      case 'R': // Right
        pose.headRotationX = (Math.random() - 0.5) * 0.05 // Slight random V
        pose.headRotationY = -headH * 1.2
        pose.headRotationZ = tilt
        pose.eyeRotationX = 0
        pose.eyeRotationY = -eyeH * 1.2
        break
    }
    return pose
  }

  // Thinking state vars
  let thinkingCurrent = { hX: 0, hY: 0, hZ: 0, eX: 0, eY: 0 }
  let thinkingTarget = { hX: 0, hY: 0, hZ: 0, eX: 0, eY: 0 }
  let thinkingDwellTimer = 0
  let thinkingCurrentSpeed = POSE_INTERPOLATION_SPEED

  /**
   * Update thinking pose interpolation
   */
  const updateThinkingPose = (deltaTime: number): void => {
    if (!vrm?.humanoid) return

    // Logic:
    // If state == thinking:
    //   If reached target & dwell expired -> Pick new target
    //   Interpolate current -> target
    // If state != thinking:
    //   Target = 0 (neutral)
    //   Interpolate current -> target
    //   If current is effectively 0, stop modifying bones

    // 1. Determine Target
    if (currentPoseState.value === 'thinking') {
      // Check if we reached target (approx)
      const dist = Math.abs(thinkingCurrent.hX - thinkingTarget.hX) +
        Math.abs(thinkingCurrent.hY - thinkingTarget.hY)

      if (dist < 0.01) {
        thinkingDwellTimer -= deltaTime * 1000
        if (thinkingDwellTimer <= 0) {
          // New Random Target
          const next = generateRandomThinkingPose()
          thinkingTarget = {
            hX: next.headRotationX,
            hY: next.headRotationY,
            hZ: next.headRotationZ,
            eX: next.eyeRotationX,
            eY: next.eyeRotationY
          }
          thinkingDwellTimer = next.dwellTime
          thinkingCurrentSpeed = next.speed
        }
      }
    } else {
      // Return to neutral
      thinkingTarget = { hX: 0, hY: 0, hZ: 0, eX: 0, eY: 0 }
      thinkingDwellTimer = 0
      thinkingCurrentSpeed = POSE_INTERPOLATION_SPEED * 1.5 // Return faster
    }

    // 2. Interpolate Current -> Target
    const speed = thinkingCurrentSpeed * deltaTime
    thinkingCurrent.hX += (thinkingTarget.hX - thinkingCurrent.hX) * speed
    thinkingCurrent.hY += (thinkingTarget.hY - thinkingCurrent.hY) * speed
    thinkingCurrent.hZ += (thinkingTarget.hZ - thinkingCurrent.hZ) * speed
    thinkingCurrent.eX += (thinkingTarget.eX - thinkingCurrent.eX) * speed
    thinkingCurrent.eY += (thinkingTarget.eY - thinkingCurrent.eY) * speed

    // 3. Optimization: If not thinking and near zero, skip applying to allow animation to take full control
    if (currentPoseState.value !== 'thinking') {
      const distToZero = Math.abs(thinkingCurrent.hX) + Math.abs(thinkingCurrent.hY)
      if (distToZero < 0.001) return
    }

    // 4. Apply to Bones
    const headBone = vrm.humanoid.humanBones.head?.node
    if (headBone && baseBoneRotations.head) {
      headBone.rotation.x = baseBoneRotations.head.x + thinkingCurrent.hX
      headBone.rotation.y = baseBoneRotations.head.y + thinkingCurrent.hY
      headBone.rotation.z = baseBoneRotations.head.z + thinkingCurrent.hZ
    }

    const leftEye = vrm.humanoid.humanBones.leftEye?.node
    const rightEye = vrm.humanoid.humanBones.rightEye?.node

    if (leftEye) {
      leftEye.rotation.x = thinkingCurrent.eX
      leftEye.rotation.y = thinkingCurrent.eY
    }
    if (rightEye) {
      rightEye.rotation.x = thinkingCurrent.eX
      rightEye.rotation.y = thinkingCurrent.eY
    }
  }

  /**
   * Store current bone rotations as base for pose modifications
   */
  const storeBoneBaseRotations = (): void => {
    if (!vrm?.humanoid) return

    const headBone = vrm.humanoid.humanBones.head?.node
    if (headBone) {
      baseBoneRotations.head = {
        x: headBone.rotation.x,
        y: headBone.rotation.y,
        z: headBone.rotation.z
      }
    }

    const neckBone = vrm.humanoid.humanBones.neck?.node
    if (neckBone) {
      baseBoneRotations.neck = {
        x: neckBone.rotation.x,
        y: neckBone.rotation.y,
        z: neckBone.rotation.z
      }
    }
  }



  /**
   * Transition to thinking state(message sent to backend)
   */
  const transitionToThinking = (): void => {
    if (currentPoseState.value === 'thinking') return

    currentPoseState.value = 'thinking'

    // Smoothly transition expression to neutral (avoid abrupt face change)
    if (vrm?.expressionManager) {
      // Get current happy value and smoothly transition to 0
      smoothTransition('happy', 0.0, 400)  // 400ms smooth transition
    }

    // Manual bone manipulation will be applied in updateThinkingPose
  }

  /**
   * Transition to talking state (response arrived)
   */
  const transitionToTalking = (): void => {
    if (currentPoseState.value === 'talking') return

    currentPoseState.value = 'talking'
    // Thinking pose will interpolate back to 0
  }

  /**
   * Transition to idle state (after response ends)
   */
  const transitionToIdle = (): void => {
    // Go back to waiting
    transitionToWaiting()
  }

  /**
   * Start render loop
   */
  const startRenderLoop = (): void => {
    const animate = () => {
      animationId = requestAnimationFrame(animate)

      const deltaTime = clock.getDelta()

      if (vrm) {
        vrm.update(deltaTime)

        // Update animation mixer - NOW ACTIVE IN ALL STATES to avoid T-Pose
        // Specific logic: 
        // - Hello: hello animation
        // - Waiting: base + randoms
        // - Attention/Thinking/Talking: base animation
        if (mixer) {
          mixer.update(deltaTime)
        }
      }

      // VISEMAS NOW USE SMOOTH TRANSITIONS - No longer updated in render loop
      // updateVisemas() // DISABLED - using smooth transitions instead

      // EXPRESSIONS TEMPORARILY DISABLED FOR TESTING
      // updateExpressions()

      // Update breathing animation
      updateBreathing()

      // Update thinking pose interpolation
      updateThinkingPose(deltaTime)

      // Update blinking (random intervals)
      updateBlinking(deltaTime)

      if (renderer && scene && camera) {
        renderer.render(scene, camera)
      }
    }

    animate()
  }

  /**
   * Handle window resize
   */
  const handleResize = (): void => {
    if (!container.value || !camera || !renderer) return

    const width = container.value.clientWidth
    const height = container.value.clientHeight

    camera.aspect = width / height
    camera.updateProjectionMatrix()

    renderer.setSize(width, height)
  }

  /**
   * Set breathing configuration
   */
  const setBreathingConfig = (config: Partial<BreathingConfig>): void => {
    breathingConfig = { ...breathingConfig, ...config }
  }

  /**
   * Handle errors
   */
  const handleError = (message: string): void => {
    console.error('Avatar renderer error:', message)
    errorMessage.value = message
    avatarState.value = AvatarState.Error
  }

  /**
   * Cleanup resources
   */
  const cleanup = (): void => {
    // Stop boring timer
    stopBoringTimer()

    // Stop render loop
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }

    // Remove resize listener
    window.removeEventListener('resize', handleResize)

    // Cleanup Three.js objects
    if (renderer && container.value?.contains(renderer.domElement)) {
      container.value.removeChild(renderer.domElement)
    }

    // Dispose of resources
    if (mixer) {
      mixer.stopAllAction()
      mixer = null
    }

    if (vrm) {
      // VRM doesn't have dispose method, just clear the reference
      vrm = null
    }

    if (renderer) {
      renderer.dispose()
      renderer = null
    }

    if (scene) {
      scene.clear()
      scene = null
    }

    loadedAnimations.clear()
    expressionQueue = []
  }

  // Cleanup on component unmount
  onUnmounted(() => {
    cleanup()
  })

  return {
    // State
    avatarState: readonly(avatarState),
    loadingProgress: readonly(loadingProgress),
    errorMessage: readonly(errorMessage),
    currentAnimation: readonly(currentAnimation),
    currentPoseState: readonly(currentPoseState),

    // Methods
    initialize,
    playAnimation,
    playExpressions,
    playVisemas,
    setBreathingConfig,

    // Pose state transitions
    transitionToAttention,
    transitionToThinking,
    transitionToTalking,
    transitionToIdle,

    // Utils
    cleanup
  }
}
