import React, { useState, useRef, useMemo, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Image, ActivityIndicator, PanResponder, Dimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
const EncodingType = FileSystem.EncodingType || { Base64: 'base64' };
import { ANTHROPIC_API_KEY } from '../config';
import * as ImageManipulator from 'expo-image-manipulator';
import { Svg, Rect, Text as SvgText, Circle, Line } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
const compressImage = async (uri: string) => {
  const manipResult = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1024 } }], // Resize to max 1024px wide
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
  return manipResult.uri;
};



const calculateTileGrid = (wallW, wallH, tileW, tileH, grout, obstacles) => {
  const parsedWallW = parseFloat(wallW) || 0;
  const parsedWallH = parseFloat(wallH) || 0;
  const parsedTileW = parseFloat(tileW) || 0;
  const parsedTileH = parseFloat(tileH) || 0;
  const parsedGrout = parseFloat(grout) || 0;

  // Guard against invalid inputs that would cause infinite loops
  if (parsedWallW <= 0 || parsedWallH <= 0 || parsedTileW <= 0 || parsedTileH <= 0) {
    return { grid: [], tilesWide: 0, tilesHigh: 0 };
  }

  const effectiveTileW = parsedTileW + parsedGrout;
  const effectiveTileH = parsedTileH + parsedGrout;

  const tilesWide = Math.ceil(parsedWallW / effectiveTileW);
  const tilesHigh = Math.ceil(parsedWallH / effectiveTileH);

  // Safety limit to prevent memory issues
  if (tilesWide > 500 || tilesHigh > 500 || tilesWide * tilesHigh > 10000) {
    console.warn('Too many tiles, limiting grid');
    return { grid: [], tilesWide: 0, tilesHigh: 0 };
  }

  const grid = [];
  let tileNumber = 1;

  for (let row = 0; row < tilesHigh; row++) {
    for (let col = 0; col < tilesWide; col++) {
      const tileX = col * effectiveTileW;
      const tileY = row * effectiveTileH;

      // Check if this tile intersects with any obstacle
      let needsCut = false;
      const affectedBy = [];

      if (obstacles && Array.isArray(obstacles)) {
        obstacles.forEach(obstacle => {
          if (!obstacle || !obstacle.position) return;
          const obsX = obstacle.position.x || 0;
          const obsY = obstacle.position.y || 0;

          // Simple intersection check
          if (obsX >= tileX && obsX <= tileX + effectiveTileW &&
              obsY >= tileY && obsY <= tileY + effectiveTileH) {
            needsCut = true;
            affectedBy.push(obstacle);
          }
        });
      }
      
      grid.push({
        number: tileNumber,
        x: tileX,
        y: tileY,
        width: effectiveTileW,
        height: effectiveTileH,
        needsCut,
        obstacles: affectedBy
      });
      
      tileNumber++;
    }
  }
  
  return { grid, tilesWide, tilesHigh };
};

const MarkedWallImage = ({ imageUri, wallWidth, wallHeight, obstacles, tileWidth, tileHeight, groutSpacing, isLandscape }) => {
  const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 });
  const [actualImageDimensions, setActualImageDimensions] = React.useState({ width: 0, height: 0 });
  const [imageError, setImageError] = React.useState(false);
  const [screenSize, setScreenSize] = React.useState(Dimensions.get('window'));

  // Check if we have valid required props
  const hasValidProps = imageUri && wallWidth && wallHeight && tileWidth && tileHeight;

  // Listen for dimension changes (orientation)
  React.useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setScreenSize(window);
    });
    return () => subscription?.remove();
  }, []);

  // Calculate image dimensions to fill available space while maintaining aspect ratio
  const getImageDimensions = () => {
    if (isLandscape) {
      // In landscape, use most of the screen
      const availableWidth = screenSize.width - 16; // padding
      const availableHeight = screenSize.height - 80; // header + legend

      // If we have actual image dimensions, calculate proper size
      if (actualImageDimensions.width > 0 && actualImageDimensions.height > 0) {
        const imageAspect = actualImageDimensions.width / actualImageDimensions.height;
        const screenAspect = availableWidth / availableHeight;

        if (imageAspect > screenAspect) {
          // Image is wider than screen - fit to width
          return { width: availableWidth, height: availableWidth / imageAspect };
        } else {
          // Image is taller than screen - fit to height
          return { width: availableHeight * imageAspect, height: availableHeight };
        }
      }

      // Fallback: use wall aspect ratio
      const wallAspect = (parseFloat(wallWidth) || 1) / (parseFloat(wallHeight) || 1);
      if (wallAspect > 1) {
        return { width: availableWidth, height: availableWidth / wallAspect };
      } else {
        return { width: availableHeight * wallAspect, height: availableHeight };
      }
    }

    // Portrait mode - fixed height
    return { width: '100%', height: 400 };
  };

  const imageDimensions = getImageDimensions();

  // Get actual image dimensions when component mounts
  React.useEffect(() => {
    if (!imageUri) return;

    Image.getSize(
      imageUri,
      (width, height) => {
        setActualImageDimensions({ width, height });
        setImageError(false);
      },
      (error) => {
        console.log('Image.getSize failed, using container size:', error);
        setImageError(true);
      }
    );
  }, [imageUri]);

  // Early return if missing required props (after hooks)
  if (!hasValidProps) {
    return (
      <View style={{ padding: 20, backgroundColor: '#FEE2E2', borderRadius: 12 }}>
        <Text style={{ color: '#DC2626', textAlign: 'center' }}>
          Missing required data for visual markup
        </Text>
      </View>
    );
  }

  // Calculate the actual displayed image size within the container (accounting for resizeMode="contain")
  const getDisplayedImageSize = () => {
    if (!containerSize.width || !containerSize.height) {
      return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
    }

    // If we couldn't get image dimensions, assume image fills container
    // This uses the wall aspect ratio as a fallback
    if (!actualImageDimensions.width || !actualImageDimensions.height || imageError) {
      const wallAspect = parseFloat(wallWidth) / parseFloat(wallHeight);
      const containerAspect = containerSize.width / containerSize.height;

      let displayedWidth, displayedHeight, offsetX, offsetY;

      if (wallAspect > containerAspect) {
        displayedWidth = containerSize.width;
        displayedHeight = containerSize.width / wallAspect;
        offsetX = 0;
        offsetY = (containerSize.height - displayedHeight) / 2;
      } else {
        displayedHeight = containerSize.height;
        displayedWidth = containerSize.height * wallAspect;
        offsetX = (containerSize.width - displayedWidth) / 2;
        offsetY = 0;
      }

      return { width: displayedWidth, height: displayedHeight, offsetX, offsetY };
    }

    const containerAspect = containerSize.width / containerSize.height;
    const imageAspect = actualImageDimensions.width / actualImageDimensions.height;

    let displayedWidth, displayedHeight, offsetX, offsetY;

    if (imageAspect > containerAspect) {
      // Image is wider - it will be limited by container width
      displayedWidth = containerSize.width;
      displayedHeight = containerSize.width / imageAspect;
      offsetX = 0;
      offsetY = (containerSize.height - displayedHeight) / 2;
    } else {
      // Image is taller - it will be limited by container height
      displayedHeight = containerSize.height;
      displayedWidth = containerSize.height * imageAspect;
      offsetX = (containerSize.width - displayedWidth) / 2;
      offsetY = 0;
    }

    return { width: displayedWidth, height: displayedHeight, offsetX, offsetY };
  };

  const displayedImage = getDisplayedImageSize();

  // Calculate scaling factor to map wall inches to displayed image pixels
  // Guard against division by zero
  const wallW = parseFloat(wallWidth) || 1;
  const wallH = parseFloat(wallHeight) || 1;
  const scaleX = displayedImage.width / wallW;
  const scaleY = displayedImage.height / wallH;

  // Calculate tile grid
  const { grid, tilesWide, tilesHigh } = calculateTileGrid(
    wallWidth, wallHeight, tileWidth, tileHeight, groutSpacing, obstacles
  );

  return (
    <View style={{ position: 'relative', alignItems: isLandscape ? 'center' : 'stretch' }}>
      <Image
        source={{ uri: imageUri }}
        style={{
          width: imageDimensions.width,
          height: imageDimensions.height,
        }}
        resizeMode="contain"
        onLayout={(e) => {
          setContainerSize({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height
          });
        }}
      />
      
      {displayedImage.width > 0 && (
        <Svg
          style={StyleSheet.absoluteFill}
          width={containerSize.width}
          height={containerSize.height}
        >
          {/* Draw tile grid */}
          {grid.map((tile) => {
            // Convert from wall inches to displayed image pixels
            // Note: SVG Y=0 is at top, but wall Y=0 is at bottom, so we invert Y
            const x = displayedImage.offsetX + tile.x * scaleX;
            const y = displayedImage.offsetY + (wallH - tile.y - tile.height) * scaleY;
            const w = tile.width * scaleX;
            const h = tile.height * scaleY;
            
            return (
              <React.Fragment key={tile.number}>
                <Rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  stroke={tile.needsCut ? "#EF4444" : "#10B981"}
                  strokeWidth={2}
                  fill={tile.needsCut ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.05)"}
                />
                
                {/* Tile number */}
                <SvgText
                  x={x + w / 2}
                  y={y + h / 2}
                  fill={tile.needsCut ? "#DC2626" : "#059669"}
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {tile.number}
                </SvgText>
              </React.Fragment>
            );
          })}
          
          {/* Mark obstacles */}
          {obstacles?.map((obstacle, index) => {
            // Convert from wall inches (Y=0 at bottom) to SVG pixels (Y=0 at top)
            const obsX = displayedImage.offsetX + (obstacle.position?.x || 0) * scaleX;
            const obsY = displayedImage.offsetY + (wallH - (obstacle.position?.y || 0)) * scaleY;
            const size = obstacle.diameter || obstacle.size?.width || 5;
            const radius = (size / 2) * scaleX;

            return (
              <React.Fragment key={index}>
                {obstacle.type === 'pipe' ? (
                  <Circle
                    cx={obsX}
                    cy={obsY}
                    r={radius}
                    stroke="#F59E0B"
                    strokeWidth={3}
                    fill="rgba(245, 158, 11, 0.2)"
                  />
                ) : (
                  <Rect
                    x={obsX - (obstacle.size?.width || 3) * scaleX / 2}
                    y={obsY - (obstacle.size?.height || 5) * scaleY / 2}
                    width={(obstacle.size?.width || 3) * scaleX}
                    height={(obstacle.size?.height || 5) * scaleY}
                    stroke="#F59E0B"
                    strokeWidth={3}
                    fill="rgba(245, 158, 11, 0.2)"
                  />
                )}

                {/* Label */}
                <SvgText
                  x={obsX}
                  y={obsY - radius - 5}
                  fill="#F59E0B"
                  fontSize="12"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {obstacle.type.toUpperCase()}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      )}
    </View>
  );
};


export default function Index() {
  const [markedImage, setMarkedImage] = useState(null);
  const [tileGrid, setTileGrid] = useState([]);
  const [detectedObstacles, setDetectedObstacles] = useState([]);
  const [wallWidth, setWallWidth] = useState('');
  const [wallHeight, setWallHeight] = useState('');
  const [tileWidth, setTileWidth] = useState('');
  const [tileHeight, setTileHeight] = useState('');
  const [groutSpacing, setGroutSpacing] = useState('0.25');
  const [aiSuggestedGrout, setAiSuggestedGrout] = useState(null);
  const [result, setResult] = useState(null);
  const [showAROverlay, setShowAROverlay] = useState(false);
  const [cameraLayout, setCameraLayout] = useState({ width: 0, height: 0 });
  const [isLandscape, setIsLandscape] = useState(false);

  const [showCamera, setShowCamera] = useState(false);
  const [cameraMode, setCameraMode] = useState('wall'); // 'wall' or 'tile'
  const [capturedWallImage, setCapturedWallImage] = useState(null);
  const [capturedTileImage, setCapturedTileImage] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingTile, setIsAnalyzingTile] = useState(false);
  const [tileCost, setTileCost] = useState('');
  const [availableCameraTypes, setAvailableCameraTypes] = useState([]);
  const [currentCameraType, setCurrentCameraType] = useState('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const cameraRef = useRef(null);
  const arViewRef = useRef(null);
  const [isCapturingAR, setIsCapturingAR] = useState(false);
  const [arCapturedImage, setArCapturedImage] = useState(null);

  // Reference object for accurate measurement
  const [selectedReferenceObject, setSelectedReferenceObject] = useState(null);
  const [showReferenceSelector, setShowReferenceSelector] = useState(false);
  const [detectedReferenceObject, setDetectedReferenceObject] = useState(null);

  // Reference object dimensions (in inches)
  const referenceObjects = {
    door: { name: 'Standard Door', width: 36, height: 80, icon: '🚪' },
    creditCard: { name: 'Credit Card', width: 3.37, height: 2.125, icon: '💳' },
    dollarBill: { name: 'Dollar Bill', width: 6.14, height: 2.61, icon: '💵' },
    outlet: { name: 'Electrical Outlet', width: 2.75, height: 4.5, icon: '🔌' },
    lightSwitch: { name: 'Light Switch', width: 2.75, height: 4.5, icon: '💡' },
    paper: { name: 'Letter Paper (8.5x11)', width: 8.5, height: 11, icon: '📄' },
    none: { name: 'No Reference (estimate)', width: 0, height: 0, icon: '❓' },
  };

  // Handle orientation changes using Dimensions (simpler, more reliable)
  // Only active when viewing the marked image modal
  useEffect(() => {
    let isMounted = true;

    // Don't set up listener unless we're viewing marked image
    if (!markedImage) {
      if (isMounted) setIsLandscape(false);
      return;
    }

    // Set initial orientation
    const { width, height } = Dimensions.get('window');
    if (isMounted) setIsLandscape(width > height);

    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      if (isMounted) setIsLandscape(window.width > window.height);
    });

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, [markedImage]);
  const [zoom, setZoom] = useState(0); // 0 = 1x, 1 = max zoom

  // Capture AR screenshot with grid overlay
  const captureARScreenshot = async () => {
    if (!arViewRef.current) {
      Alert.alert('Error', 'AR view not ready');
      return;
    }

    setIsCapturingAR(true);

    try {
      // Request media library permission if not granted
      if (!mediaPermission?.granted) {
        const { granted } = await requestMediaPermission();
        if (!granted) {
          Alert.alert('Permission needed', 'Photo library permission is required to save AR screenshots');
          setIsCapturingAR(false);
          return;
        }
      }

      // Capture the AR view
      const uri = await arViewRef.current.capture();
      console.log('📸 AR Screenshot captured:', uri);

      // Save to camera roll
      const asset = await MediaLibrary.createAssetAsync(uri);
      console.log('💾 Saved to gallery:', asset.uri);

      // Store for viewing in the app
      setArCapturedImage(uri);

      Alert.alert(
        'AR Photo Saved!',
        'The tile grid overlay has been saved to your photo gallery. You can use this as a reference while tiling.',
        [
          { text: 'View Photo', onPress: () => setMarkedImage(uri) },
          { text: 'Continue', style: 'cancel' }
        ]
      );

    } catch (error) {
      console.error('❌ AR capture error:', error);
      Alert.alert('Capture Failed', 'Could not capture AR screenshot. Please try again.');
    }

    setIsCapturingAR(false);
  };

  const analyzeWallImage = async (imageUri, referenceObj = null) => {
  setIsAnalyzing(true);

  try {
    const compressedUri = await compressImage(imageUri);

    const base64 = await FileSystem.readAsStringAsync(compressedUri, {
      encoding: 'base64',
    });

    // Build reference object instructions
    let referenceInstructions = '';
    if (referenceObj && referenceObj !== 'none' && referenceObjects[referenceObj]) {
      const ref = referenceObjects[referenceObj];
      referenceInstructions = `
CRITICAL: The user has placed a ${ref.name} in the image as a reference object.
The ${ref.name} measures exactly ${ref.width}" wide x ${ref.height}" tall.
You MUST:
1. First locate the ${ref.name} in the image
2. Measure the wall dimensions by comparing pixel sizes to the known reference object size
3. This will give you ACCURATE measurements - use them!

For example: If the ${ref.name} (${ref.width}" wide) takes up 10% of the image width, and the wall takes up 80% of the image width, then the wall is approximately ${ref.width} * 8 = ${ref.width * 8}" wide.
`;
    } else {
      referenceInstructions = `
No reference object was specified. Look for these common objects to estimate scale:
- Standard door: 80" tall, 36" wide
- Electrical outlet: 2.75" wide, 4.5" tall
- Light switch: 2.75" wide, 4.5" tall
- Standard ceiling height: typically 96" (8 feet)
- Window: typically 36-48" wide
`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64
                }
              },
              {
                type: "text",
                text: `Analyze this wall for tile installation. Provide ACCURATE dimensions using the reference object, and identify any obstacles.
${referenceInstructions}

Also look for these obstacles that will require special tile cuts:
- Electrical outlets or switches
- Pipes (water, gas, drain)
- Windows or window frames
- Door frames
- Fixtures (towel bars, toilet paper holders)
- Vents or registers
- Any protrusions or recesses

For each obstacle, estimate:
- Type of obstacle
- Approximate location (top/middle/bottom, left/center/right)
- Approximate position in inches from bottom-left corner
- Size/diameter if visible

Respond ONLY with JSON (no markdown):
{
  "width": 120,
  "height": 96,
  "confidence": "high",
  "referenceObjectFound": true,
  "referenceObjectUsed": "door",
  "reasoning": "Measured wall relative to standard door (36x80 inches) visible in image",
  "obstacles": [
    {
      "type": "outlet",
      "location": "center-right",
      "position": {"x": 90, "y": 48},
      "size": {"width": 3, "height": 5},
      "cutGuidance": "Will need rectangular cutout in 1-2 tiles"
    },
    {
      "type": "pipe",
      "location": "bottom-left",
      "position": {"x": 12, "y": 6},
      "diameter": 2,
      "cutGuidance": "Will need circular notch in 1 tile"
    }
  ],
  "totalObstacles": 2,
  "cutTilesEstimate": 3
}`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    const text = data.content.find(item => item.type === "text")?.text || "";
    const cleanText = text.replace(/```json|```/g, "").trim();
    const aiResult = JSON.parse(cleanText);
    
    setWallWidth(aiResult.width.toString());
    setWallHeight(aiResult.height.toString());

    // Save detected reference object info
    if (aiResult.referenceObjectFound) {
      setDetectedReferenceObject({
        found: true,
        type: aiResult.referenceObjectUsed,
        confidence: aiResult.confidence
      });
    }

    // Save obstacles for display
    if (aiResult.obstacles && aiResult.obstacles.length > 0) {
      setDetectedObstacles(aiResult.obstacles);
    }

    // Build reference object info
    let referenceText = '';
    if (aiResult.referenceObjectFound && aiResult.referenceObjectUsed) {
      const refName = referenceObjects[aiResult.referenceObjectUsed]?.name || aiResult.referenceObjectUsed;
      referenceText = `\n📏 Reference: ${refName}`;
    }

    // Build obstacle summary
    let obstacleText = '';
    if (aiResult.obstacles && aiResult.obstacles.length > 0) {
      obstacleText = `\n\n🔧 Obstacles Detected (${aiResult.totalObstacles}):\n`;
      aiResult.obstacles.forEach((obs, i) => {
        obstacleText += `\n${i + 1}. ${obs.type.toUpperCase()} at ${obs.location}\n   ${obs.cutGuidance}`;
      });
      obstacleText += `\n\n⚠️ Estimated ${aiResult.cutTilesEstimate || aiResult.obstacles.length} tiles will need special cuts`;
    }

    const confidenceEmoji = aiResult.confidence === 'high' ? '✅' : aiResult.confidence === 'medium' ? '⚠️' : '❓';

    Alert.alert('AI Analysis Complete',
      `Wall: ${aiResult.width}" × ${aiResult.height}"\n${confidenceEmoji} Confidence: ${aiResult.confidence}${referenceText}\n\n${aiResult.reasoning}${obstacleText}`,
      [{ text: 'OK' }],
      { cancelable: true }
    );
    
  } catch (error) {
    console.error("AI Error:", error);
    Alert.alert('Analysis Failed', 'Could not analyze image. Using estimate.');
    
    const mockWidth = Math.floor(Math.random() * 60) + 80;
    const mockHeight = Math.floor(Math.random() * 40) + 70;
    setWallWidth(mockWidth.toString());
    setWallHeight(mockHeight.toString());
  }
  
  setIsAnalyzing(false);
};

  const analyzeTileImage = async (imageUri) => {
  setIsAnalyzingTile(true);
  
  try {
    // Compress image first
    const compressedUri = await compressImage(imageUri);
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: 'base64',
    });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64
                }
              },
              {
                type: "text",
                text: `Analyze this tile and determine its dimensions in inches.

Look for:
- Tile shape (square, rectangular)
- Measurements or labels on packaging
- Compare to common sizes: 4×4, 6×6, 12×12, 12×24, 18×18

Grout recommendations:
- 12×12 ceramic: 1/8" to 1/4"
- 12×24 large format: 1/8" to 3/16"
- 6×6 small: 1/8"
- 18×18 large: 1/8" to 3/16"

Respond ONLY with JSON (no markdown):
{
  "width": 12,
  "height": 12,
  "suggestedGroutSpacing": 0.125,
  "confidence": "medium",
  "reasoning": "Square ceramic tile, likely 12×12"
}`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    const text = data.content.find(item => item.type === "text")?.text || "";
    const cleanText = text.replace(/```json|```/g, "").trim();
    const aiResult = JSON.parse(cleanText);
	
    
    setTileWidth(aiResult.width.toString());
    setTileHeight(aiResult.height.toString());
    
    if (aiResult.suggestedGroutSpacing) {
      setAiSuggestedGrout(aiResult.suggestedGroutSpacing);
      setGroutSpacing(aiResult.suggestedGroutSpacing.toString());
    }
    
    Alert.alert('Tile Analysis Complete', 
      `Size: ${aiResult.width}" × ${aiResult.height}"\nGrout: ${aiResult.suggestedGroutSpacing}"\n\n${aiResult.reasoning}`);
    
  } catch (error) {
    console.error("Tile AI Error:", error);
    Alert.alert('Analysis Failed', 'Could not analyze tile. Using estimate.');
    
    const commonTiles = [{ w: 12, h: 12 }, { w: 12, h: 24 }, { w: 6, h: 6 }];
    const tile = commonTiles[Math.floor(Math.random() * commonTiles.length)];
    setTileWidth(tile.w.toString());
    setTileHeight(tile.h.toString());
  }
  
  setIsAnalyzingTile(false);
};

  const openCamera = async (mode) => {
    if (!permission) {
      await requestPermission();
    }

    if (permission?.granted) {
      // Reset landscape state before opening camera
      setIsLandscape(false);
      setCameraMode(mode);
      setShowCamera(true);
    } else {
      Alert.alert('Permission needed', 'Camera permission is required');
      requestPermission();
    }
  };

  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        console.log('📸 Taking picture...');
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.5,        // 0 to 1, lower = smaller file
          base64: false,
          imageType: 'jpg',
          skipProcessing: true,
        });

        console.log('✅ Photo taken, closing camera');
        // Reset all overlay/view states
        setShowAROverlay(false);
        setZoom(0);
        setMarkedImage(null);  // Clear marked image to prevent orientation issues
        setIsLandscape(false); // Reset landscape state
        setShowCamera(false);

        console.log('🤖 Starting AI analysis');
        if (cameraMode === 'wall') {
          setCapturedWallImage(photo.uri);
          await analyzeWallImage(photo.uri, selectedReferenceObject);
        } else {
          setCapturedTileImage(photo.uri);
          await analyzeTileImage(photo.uri);
        }
        console.log('✅ Analysis complete');
      } catch (error) {
        console.error('❌ Error taking picture:', error);
        setShowAROverlay(false);
        setZoom(0);
        setMarkedImage(null);
        setIsLandscape(false);
        setShowCamera(false);
        Alert.alert('Camera Error', 'Failed to take picture. Please try again.');
      }
    }
  };

  const pickImage = async (mode) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled) {
      const imageUri = result.assets[0].uri;

      if (mode === 'wall') {
        setCapturedWallImage(imageUri);
        await analyzeWallImage(imageUri, selectedReferenceObject);
      } else {
        setCapturedTileImage(imageUri);
        await analyzeTileImage(imageUri);
      }
    }
  };

  const calculateTiles = () => {
  const wWidth = parseFloat(wallWidth);
  const wHeight = parseFloat(wallHeight);
  const tWidth = parseFloat(tileWidth);
  const tHeight = parseFloat(tileHeight);
  const grout = parseFloat(groutSpacing);

  if (isNaN(wWidth) || isNaN(wHeight) || isNaN(tWidth) || isNaN(tHeight)) {
    Alert.alert('Error', 'Please enter valid numbers');
    return;
  }

  const effectiveTileWidth = tWidth + grout;
  const effectiveTileHeight = tHeight + grout;
  const tilesWide = wWidth / effectiveTileWidth;
  const tilesHigh = wHeight / effectiveTileHeight;

  const fullTilesWide = Math.floor(tilesWide);
  const fullTilesHigh = Math.floor(tilesHigh);
  const fullTiles = fullTilesWide * fullTilesHigh;

  const partialWide = tilesWide - fullTilesWide;
  const partialHigh = tilesHigh - fullTilesHigh;

  const edgeTilesRight = partialWide > 0 ? fullTilesHigh : 0;
  const edgeTilesTop = partialHigh > 0 ? fullTilesWide : 0;
  const cornerTile = (partialWide > 0 && partialHigh > 0) ? 1 : 0;

  const cutTiles = Math.ceil(edgeTilesRight + edgeTilesTop + cornerTile);
  const totalBeforeWaste = fullTiles + cutTiles;
  const tilesNeeded = Math.ceil(totalBeforeWaste * 1.1);

  // Calculate cost
  const cost = tileCost ? parseFloat(tileCost) : 0;
  const totalCost = cost > 0 ? (tilesNeeded * cost).toFixed(2) : null;

  setResult({
    tilesNeeded,
    fullTiles,
    cutTiles,
    tilesWide: tilesWide.toFixed(2),
    tilesHigh: tilesHigh.toFixed(2),
    totalCost,
   });
  };

  // Pinch-to-zoom using PanResponder (most reliable for multi-touch)
  const lastPinchDistance = useRef(0);
  const zoomBeforePinch = useRef(0);

  const getDistance = (touches) => {
    if (!touches || touches.length < 2) return 0;
    const [t1, t2] = touches;
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 2,
    onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 2,
    onPanResponderGrant: (evt) => {
      lastPinchDistance.current = getDistance(evt.nativeEvent.touches);
      zoomBeforePinch.current = zoom;
    },
    onPanResponderMove: (evt) => {
      if (evt.nativeEvent.touches.length === 2) {
        const currentDistance = getDistance(evt.nativeEvent.touches);
        if (lastPinchDistance.current > 0) {
          const scale = currentDistance / lastPinchDistance.current;
          const newZoom = Math.min(Math.max(zoomBeforePinch.current * scale, 0), 1);
          setZoom(newZoom);
        }
      }
    },
    onPanResponderRelease: () => {
      lastPinchDistance.current = 0;
    },
  }), [zoom]);

  // Convert zoom (0-1) to display multiplier (1x-8x approximately)
  const getZoomDisplay = () => {
    const displayZoom = 1 + (zoom * 7);
    return displayZoom.toFixed(1);
  };

  // Check if we have enough data for AR overlay
  const canShowAROverlay = wallWidth && wallHeight && tileWidth && tileHeight && cameraMode === 'wall';

  // Calculate AR grid for camera overlay
  const getARGrid = () => {
    if (!canShowAROverlay || !cameraLayout.width || !cameraLayout.height) {
      return { grid: [], tilesWide: 0, tilesHigh: 0, fullTiles: 0, cutTiles: 0 };
    }

    const { grid, tilesWide, tilesHigh } = calculateTileGrid(
      wallWidth, wallHeight, tileWidth, tileHeight, groutSpacing, []
    );

    // Count full vs cut tiles (edge tiles need cuts)
    let fullTiles = 0;
    let cutTiles = 0;

    grid.forEach((tile, index) => {
      const col = index % tilesWide;
      const row = Math.floor(index / tilesWide);
      const isEdge = col === tilesWide - 1 || row === tilesHigh - 1;
      if (isEdge) {
        cutTiles++;
      } else {
        fullTiles++;
      }
    });

    return { grid, tilesWide, tilesHigh, fullTiles, cutTiles };
  };

  const arData = getARGrid();

  // Debug: Log render state
  console.log('🔄 Render state:', {
    showCamera,
    markedImage: !!markedImage,
    capturedWallImage: !!capturedWallImage,
    isLandscape,
    tileWidth,
    tileHeight
  });

  // Camera View
  if (showCamera) {
    console.log('📷 Rendering Camera View');
    return (
      <View
        style={styles.cameraContainer}
        {...panResponder.panHandlers}
        onLayout={(e) => {
          setCameraLayout({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height
          });
        }}
      >
        {/* Wrap camera and overlay in ViewShot for AR capture */}
        <ViewShot
          ref={arViewRef}
          options={{ format: 'jpg', quality: 0.9 }}
          style={StyleSheet.absoluteFill}
        >
          <CameraView
            style={styles.camera}
            ref={cameraRef}
            facing="back"
            zoom={zoom}
          />

          {/* AR Tile Grid Overlay */}
          {showAROverlay && canShowAROverlay && cameraLayout.width > 0 && (
            <Svg
              style={StyleSheet.absoluteFill}
              width={cameraLayout.width}
              height={cameraLayout.height}
            >
              {(() => {
                // Calculate effective tile dimensions (same as grid calculation)
                const tileW = parseFloat(tileWidth) || 0;
                const tileH = parseFloat(tileHeight) || 0;
                const grout = parseFloat(groutSpacing) || 0;
                const effectiveTileW = tileW + grout;
                const effectiveTileH = tileH + grout;

                // Calculate actual grid coverage (not wall size)
                const actualGridW = arData.tilesWide * effectiveTileW;
                const actualGridH = arData.tilesHigh * effectiveTileH;

                // Guard against division by zero
                if (actualGridW <= 0 || actualGridH <= 0) {
                  return null;
                }

                // Use 80% of camera view for the grid (with padding)
                const padding = 0.1;
                const gridWidth = cameraLayout.width * (1 - padding * 2);
                const gridHeight = cameraLayout.height * (1 - padding * 2);
                const offsetX = cameraLayout.width * padding;
                const offsetY = cameraLayout.height * padding;

                // Scale based on actual grid coverage, not wall dimensions
                const scaleX = gridWidth / actualGridW;
                const scaleY = gridHeight / actualGridH;

                return arData.grid.map((tile, index) => {
                  const x = offsetX + tile.x * scaleX;
                  const y = offsetY + (actualGridH - tile.y - tile.height) * scaleY;
                  const w = tile.width * scaleX;
                  const h = tile.height * scaleY;

                  // Determine if this is an edge tile (needs cutting)
                  const col = index % arData.tilesWide;
                  const row = Math.floor(index / arData.tilesWide);
                  const isEdge = col === arData.tilesWide - 1 || row === arData.tilesHigh - 1;

                  return (
                    <Rect
                      key={tile.number}
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      stroke={isEdge ? "#F59E0B" : "#10B981"}
                      strokeWidth={1.5}
                      fill={isEdge ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.1)"}
                    />
                  );
                });
              })()}
            </Svg>
          )}
        </ViewShot>

        {/* AR Info Panel */}
        {showAROverlay && canShowAROverlay && (
          <View style={styles.arInfoPanel}>
            <Text style={styles.arInfoTitle}>Live Preview</Text>
            <Text style={styles.arInfoText}>
              {arData.tilesWide} × {arData.tilesHigh} tiles
            </Text>
            <Text style={styles.arInfoText}>
              <Text style={{ color: '#10B981' }}>■</Text> Full: {arData.fullTiles}
              <Text style={{ color: '#F59E0B' }}> ■</Text> Cut: {arData.cutTiles}
            </Text>
          </View>
        )}

        <View style={[styles.cameraHeader, { position: 'absolute', top: 0, left: 0, right: 0 }]}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => {
              setShowCamera(false);
              setZoom(0);
              setShowAROverlay(false);
            }}
          >
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.cameraHint}>
            {cameraMode === 'wall' ? 'Align wall in frame' : 'Photograph tile'}
          </Text>
        </View>

        {/* Left side controls - AR toggle */}
        {cameraMode === 'wall' && (
          <View style={{ position: 'absolute', left: 20, top: 120 }}>
            <TouchableOpacity
              style={[
                styles.arToggleButton,
                showAROverlay && styles.arToggleButtonActive,
                !canShowAROverlay && styles.arToggleButtonDisabled
              ]}
              onPress={() => {
                if (canShowAROverlay) {
                  setShowAROverlay(!showAROverlay);
                } else {
                  Alert.alert(
                    'Enter Dimensions First',
                    'Please enter wall and tile dimensions before using AR preview.',
                    [{ text: 'OK' }]
                  );
                }
              }}
            >
              <Text style={styles.arToggleIcon}>📐</Text>
              <Text style={[
                styles.arToggleText,
                showAROverlay && styles.arToggleTextActive
              ]}>
                {showAROverlay ? 'AR ON' : 'AR'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Zoom indicator and quick buttons */}
        <View style={{ position: 'absolute', right: 20, top: 120, gap: 10, alignItems: 'center' }}>
          <TouchableOpacity
            style={styles.zoomButton}
            onPress={() => setZoom(Math.min(zoom + 0.02, 1))}
          >
            <Text style={styles.zoomButtonText}>+</Text>
          </TouchableOpacity>

          <View style={styles.zoomIndicator}>
            <Text style={styles.zoomIndicatorText}>{getZoomDisplay()}x</Text>
          </View>

          <TouchableOpacity
            style={styles.zoomButton}
            onPress={() => setZoom(Math.max(zoom - 0.02, 0))}
          >
            <Text style={styles.zoomButtonText}>−</Text>
          </TouchableOpacity>

          {/* Quick zoom presets */}
          <View style={{ marginTop: 8, gap: 6 }}>
            <TouchableOpacity
              style={[styles.zoomPreset, zoom === 0 && styles.zoomPresetActive]}
              onPress={() => setZoom(0)}
            >
              <Text style={[styles.zoomPresetText, zoom === 0 && styles.zoomPresetTextActive]}>1x</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.zoomPreset, Math.abs(zoom - 0.05) < 0.02 && styles.zoomPresetActive]}
              onPress={() => setZoom(0.05)}
            >
              <Text style={[styles.zoomPresetText, Math.abs(zoom - 0.05) < 0.02 && styles.zoomPresetTextActive]}>1.5x</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.zoomPreset, Math.abs(zoom - 0.14) < 0.02 && styles.zoomPresetActive]}
              onPress={() => setZoom(0.14)}
            >
              <Text style={[styles.zoomPresetText, Math.abs(zoom - 0.14) < 0.02 && styles.zoomPresetTextActive]}>2x</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.zoomPreset, Math.abs(zoom - 0.28) < 0.02 && styles.zoomPresetActive]}
              onPress={() => setZoom(0.28)}
            >
              <Text style={[styles.zoomPresetText, Math.abs(zoom - 0.28) < 0.02 && styles.zoomPresetTextActive]}>3x</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.cameraFooter, { position: 'absolute', bottom: 40, left: 0, right: 0 }]}>
          {/* AR Capture Button - only show when AR overlay is active */}
          {showAROverlay && canShowAROverlay && (
            <TouchableOpacity
              style={styles.arCaptureButton}
              onPress={captureARScreenshot}
              disabled={isCapturingAR}
            >
              {isCapturingAR ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.arCaptureIcon}>📸</Text>
                  <Text style={styles.arCaptureText}>AR</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Main capture button */}
          <TouchableOpacity
            style={styles.captureButton}
            onPress={takePicture}
          >
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>

          {/* Placeholder for symmetry when AR button is shown */}
          {showAROverlay && canShowAROverlay && (
            <View style={{ width: 60 }} />
          )}
        </View>
      </View>
    );
  }

// Marked Image Modal
if (markedImage && tileWidth && tileHeight) {
  console.log('🎨 Rendering Marked Image Modal');

  if (isLandscape) {
    // Landscape: Full-screen immersive view
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {/* Close button - floating in corner */}
        <TouchableOpacity
          onPress={() => setMarkedImage(null)}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 10,
            padding: 8,
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderRadius: 20,
            width: 36,
            height: 36,
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>✕</Text>
        </TouchableOpacity>

        {/* Full-screen image with grid */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 8 }}>
          <MarkedWallImage
            imageUri={markedImage}
            wallWidth={wallWidth}
            wallHeight={wallHeight}
            obstacles={detectedObstacles}
            tileWidth={tileWidth}
            tileHeight={tileHeight}
            groutSpacing={groutSpacing}
            isLandscape={isLandscape}
          />
        </View>

        {/* Minimal legend bar at bottom */}
        <View style={{
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 20,
          paddingVertical: 6,
          backgroundColor: 'rgba(0,0,0,0.7)',
        }}>
          <Text style={{ color: '#10B981', fontSize: 11 }}>🟢 Full</Text>
          <Text style={{ color: '#EF4444', fontSize: 11 }}>🔴 Cut</Text>
          <Text style={{ color: '#F59E0B', fontSize: 11 }}>🟡 Obstacle</Text>
        </View>
      </View>
    );
  }

  // Portrait mode
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <ScrollView>
        <View style={{ padding: 16 }}>
          {/* Header */}
          <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 16,
            paddingTop: 20
          }}>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>
              Visual Markup
            </Text>
            <TouchableOpacity
              onPress={() => setMarkedImage(null)}
              style={{
                padding: 8,
                backgroundColor: 'rgba(255,255,255,0.2)',
                borderRadius: 20,
                width: 40,
                height: 40,
                justifyContent: 'center',
                alignItems: 'center'
              }}
            >
              <Text style={{ color: '#fff', fontSize: 24, fontWeight: 'bold' }}>✕</Text>
            </TouchableOpacity>
          </View>

          <MarkedWallImage
            imageUri={markedImage}
            wallWidth={wallWidth}
            wallHeight={wallHeight}
            obstacles={detectedObstacles}
            tileWidth={tileWidth}
            tileHeight={tileHeight}
            groutSpacing={groutSpacing}
            isLandscape={isLandscape}
          />

          {/* Full legend */}
          <View style={{ marginTop: 16, backgroundColor: '#1F2937', padding: 16, borderRadius: 12 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
              Legend:
            </Text>
            <Text style={{ color: '#10B981', marginBottom: 4 }}>🟢 Green = Full tiles (no cuts)</Text>
            <Text style={{ color: '#EF4444', marginBottom: 4 }}>🔴 Red = Tiles need cuts</Text>
            <Text style={{ color: '#F59E0B', marginBottom: 4 }}>🟡 Yellow = Obstacles</Text>
          </View>

          {/* Tip for landscape */}
          <Text style={{ color: '#9CA3AF', fontSize: 12, textAlign: 'center', marginTop: 12 }}>
            📱 Rotate phone for full-screen view
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

  console.log('🎨 Rendering main UI');

  // Use a key to force ScrollView re-creation when capturedWallImage changes
  const scrollKey = `main-scroll-${capturedWallImage ? 'with-image' : 'no-image'}`;

  return (
    <View style={{ flex: 1, backgroundColor: '#FEF3E2' }}>
    <ScrollView key={scrollKey} style={{ flex: 1 }}>
    <View style={styles.header}>
      <View style={styles.headerContent}>
        <View>
          <Text style={styles.title}>TileCalc Pro</Text>
          <Text style={styles.subtitle}>AI-Powered Tile Estimation</Text>
        </View>
        <Image 
          source={{ uri: 'https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/3908809.png' }} 
          style={styles.jarrettImage}
        />
      </View>
    </View>
      
      {/* Wall Camera Section */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📸 Wall Detection</Text>

        {/* Reference Object Selector */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 }}>
            📏 Reference Object (for accurate measurement)
          </Text>
          <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
            Place one of these in your photo for better accuracy:
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(referenceObjects).map(([key, ref]) => (
              <TouchableOpacity
                key={key}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: selectedReferenceObject === key ? '#2563EB' : '#F3F4F6',
                  borderWidth: 2,
                  borderColor: selectedReferenceObject === key ? '#1D4ED8' : '#E5E7EB',
                }}
                onPress={() => setSelectedReferenceObject(key)}
              >
                <Text style={{
                  fontSize: 13,
                  color: selectedReferenceObject === key ? '#fff' : '#374151',
                  fontWeight: selectedReferenceObject === key ? 'bold' : 'normal',
                }}>
                  {ref.icon} {ref.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {selectedReferenceObject && selectedReferenceObject !== 'none' && (
            <View style={{ marginTop: 12, backgroundColor: '#DBEAFE', padding: 12, borderRadius: 8 }}>
              <Text style={{ fontSize: 13, color: '#1E40AF' }}>
                ✅ Place a {referenceObjects[selectedReferenceObject].name} in your wall photo.
                {'\n'}Known size: {referenceObjects[selectedReferenceObject].width}" × {referenceObjects[selectedReferenceObject].height}"
              </Text>
            </View>
          )}
        </View>

        {capturedWallImage ? (
          <View style={styles.imageContainer}>
            <Image source={{ uri: capturedWallImage }} style={styles.capturedImage} />
            {isAnalyzing ? (
              <View style={styles.analyzingContainer}>
                <ActivityIndicator size="large" color="#2563EB" />
                <Text style={styles.analyzingText}>AI analyzing wall{selectedReferenceObject ? ` with ${referenceObjects[selectedReferenceObject]?.name}` : ''}...</Text>
              </View>
            ) : (
              <>
                {/* Show detected reference info */}
                {detectedReferenceObject?.found && (
                  <View style={{ backgroundColor: '#D1FAE5', padding: 12, borderRadius: 8, marginBottom: 8 }}>
                    <Text style={{ fontSize: 13, color: '#065F46' }}>
                      ✅ Reference object detected - measurements are more accurate!
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.retakeButton}
                  onPress={() => {
                    setCapturedWallImage(null);
                    setDetectedReferenceObject(null);
                  }}
                >
                  <Text style={styles.retakeText}>Use Different Photo</Text>
                </TouchableOpacity>

                {detectedObstacles.length > 0 && (
                  <TouchableOpacity
                    style={[styles.cameraButton, { marginTop: 12 }]}
                    onPress={() => {
                      console.log('Markup button clicked!');
                      setMarkedImage(capturedWallImage);
                    }}
                  >
                    <Text style={styles.cameraButtonText}>🎨 View Visual Markup</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        ) : (
          <View style={styles.cameraButtons}>
            <TouchableOpacity
              style={styles.cameraButton}
              onPress={() => openCamera('wall')}
            >
              <Text style={styles.cameraButtonText}>📷 Open Camera</Text>
            </TouchableOpacity>

            <Text style={styles.orText}>or</Text>

            <TouchableOpacity
              style={[styles.cameraButton, styles.uploadButton]}
              onPress={() => pickImage('wall')}
            >
              <Text style={styles.cameraButtonText}>📁 Upload Photo</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Wall Dimensions */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Wall Dimensions (inches)</Text>
        <View style={styles.row}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Width</Text>
            <TextInput
              style={styles.input}
              placeholder="120"
              keyboardType="numeric"
              value={wallWidth}
              onChangeText={setWallWidth}
            />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Height</Text>
            <TextInput
              style={styles.input}
              placeholder="96"
              keyboardType="numeric"
              value={wallHeight}
              onChangeText={setWallHeight}
            />
          </View>
        </View>
      </View>
	
	{/* Detected Obstacles */}
	{detectedObstacles.length > 0 && (
	  <View style={[styles.card, { backgroundColor: '#FEF3C7' }]}>
		<Text style={styles.cardTitle}>🔧 Obstacles Detected</Text>
		{detectedObstacles.map((obstacle, index) => (
		  <View key={index} style={styles.obstacleItem}>
			<Text style={styles.obstacleType}>
			  {index + 1}. {obstacle.type.toUpperCase()}
			</Text>
			<Text style={styles.obstacleLocation}>
			  Location: {obstacle.location}
			</Text>
			<Text style={styles.obstacleCut}>
			  ✂️ {obstacle.cutGuidance}
			</Text>
		  </View>
		))}
		<Text style={styles.obstacleTotal}>
		  Total: ~{detectedObstacles.length} tiles need special cuts
		</Text>
	  </View>
	)}
	
	
      {/* Tile Camera Section */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔲 Tile Detection</Text>
        
        {capturedTileImage ? (
          <View style={styles.imageContainer}>
            <Image source={{ uri: capturedTileImage }} style={styles.capturedImage} />
            {isAnalyzingTile ? (
              <View style={styles.analyzingContainer}>
                <ActivityIndicator size="large" color="#8B5CF6" />
                <Text style={styles.analyzingText}>AI analyzing tile...</Text>
              </View>
            ) : (
              <TouchableOpacity 
                style={styles.retakeButton}
                onPress={() => setCapturedTileImage(null)}
              >
                <Text style={styles.retakeText}>Use Different Photo</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.cameraButtons}>
            <TouchableOpacity 
              style={[styles.cameraButton, styles.tileButton]}
              onPress={() => openCamera('tile')}
            >
              <Text style={styles.cameraButtonText}>📷 Photograph Tile</Text>
            </TouchableOpacity>
            
            <Text style={styles.orText}>or</Text>
            
            <TouchableOpacity 
              style={[styles.cameraButton, styles.uploadButton]}
              onPress={() => pickImage('tile')}
            >
              <Text style={styles.cameraButtonText}>📁 Upload Tile Photo</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Tile Size */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tile Size (inches)</Text>
        
        <View style={styles.presetRow}>
          <TouchableOpacity 
            style={styles.presetButton}
            onPress={() => { setTileWidth('12'); setTileHeight('12'); }}
          >
            <Text style={styles.presetText}>12"×12"</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.presetButton}
            onPress={() => { setTileWidth('12'); setTileHeight('24'); }}
          >
            <Text style={styles.presetText}>12"×24"</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.presetButton}
            onPress={() => { setTileWidth('6'); setTileHeight('6'); }}
          >
            <Text style={styles.presetText}>6"×6"</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Width</Text>
            <TextInput
              style={styles.input}
              placeholder="12"
              keyboardType="numeric"
              value={tileWidth}
              onChangeText={setTileWidth}
            />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Height</Text>
            <TextInput
              style={styles.input}
              placeholder="12"
              keyboardType="numeric"
              value={tileHeight}
              onChangeText={setTileHeight}
            />
          </View>
        </View>
      </View>

      {/* Grout Spacing */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Grout Spacing (inches)</Text>
        
        {aiSuggestedGrout && (
          <View style={styles.aiSuggestion}>
            <Text style={styles.aiSuggestionText}>
              ✨ AI suggests {aiSuggestedGrout}" spacing
            </Text>
          </View>
        )}
        
        <View style={styles.presetRow}>
          {[
            { value: '0.0625', label: '1/16"' },
            { value: '0.125', label: '1/8"' },
            { value: '0.1875', label: '3/16"' },
            { value: '0.25', label: '1/4"' },
          ].map((preset) => (
            <TouchableOpacity
              key={preset.value}
              style={[
                styles.groutButton,
                groutSpacing === preset.value && styles.groutButtonActive
              ]}
              onPress={() => setGroutSpacing(preset.value)}
            >
              <Text style={[
                styles.groutText,
                groutSpacing === preset.value && styles.groutTextActive
              ]}>
                {preset.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        

        <TextInput
          style={styles.input}
          placeholder="0.25"
          keyboardType="numeric"
          value={groutSpacing}
          onChangeText={setGroutSpacing}
        />
      </View>
      
        {/* Cost Estimator */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>💰 Cost Estimator</Text>
  
          <View style={styles.inputContainer}>
          <Text style={styles.label}>Price Per Tile ($)</Text>
          <TextInput
            style={styles.input}
            placeholder="2.50"
            keyboardType="numeric"
            value={tileCost}
            onChangeText={setTileCost}
          />
       </View>
  
  <Text style={styles.helpText}>
    Enter the cost of one tile to calculate total project cost
  </Text>
</View>

      <TouchableOpacity 
        style={styles.calculateButton} 
        onPress={calculateTiles}
      >
        <Text style={styles.calculateButtonText}>Calculate Tiles</Text>
      </TouchableOpacity>

      {result && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>Your Results</Text>
          
          <View style={styles.resultSection}>
            <Text style={styles.resultLabel}>Tile Layout</Text>
            <View style={styles.resultRow}>
              <View style={styles.resultBox}>
                <Text style={styles.resultValue}>{result.tilesWide}</Text>
                <Text style={styles.resultSubtext}>Wide</Text>
              </View>
              <View style={styles.resultBox}>
                <Text style={styles.resultValue}>{result.tilesHigh}</Text>
                <Text style={styles.resultSubtext}>High</Text>
              </View>
            </View>
          </View>

          <View style={styles.resultSection}>
            <Text style={styles.resultLabel}>Cut Tiles</Text>
            <View style={styles.resultRow}>
              <View style={styles.resultBox}>
                <Text style={styles.resultValue}>{result.fullTiles}</Text>
                <Text style={styles.resultSubtext}>Full</Text>
              </View>
              <View style={styles.resultBox}>
                <Text style={[styles.resultValue, styles.cutValue]}>{result.cutTiles}</Text>
                <Text style={styles.resultSubtext}>Cut</Text>
              </View>
            </View>
          </View>

          <View style={styles.totalSection}>
            <Text style={styles.totalLabel}>Total Tiles:</Text>
            <Text style={styles.totalValue}>{result.tilesNeeded}</Text>
          </View>
            
            {result.totalCost && (
  <View style={[styles.totalSection, { marginTop: 12, backgroundColor: 'rgba(34, 197, 94, 0.2)' }]}>
    <Text style={styles.totalLabel}>Total Cost:</Text>
    <Text style={[styles.totalValue, { color: '#86EFAC' }]}>${result.totalCost}</Text>
  </View>
)}
          
          <Text style={styles.disclaimer}>
            * Includes {result.cutTiles} cut tiles + 10% waste
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEF3E2',
  },
  header: {
    backgroundColor: '#92400E',
    padding: 24,
    paddingTop: 60,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  jarrettImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    borderColor: '#FDE68A',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#FDE68A',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    margin: 16,
    marginBottom: 8,
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 16,
  },
  cameraButtons: {
    gap: 12,
  },
  cameraButton: {
    backgroundColor: '#2563EB',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  tileButton: {
    backgroundColor: '#8B5CF6',
  },
  uploadButton: {
    backgroundColor: '#6366F1',
  },
  cameraButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  orText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 14,
  },
  imageContainer: {
    gap: 12,
  },
  capturedImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
  },
  analyzingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  analyzingText: {
    color: '#2563EB',
    fontSize: 16,
    fontWeight: '600',
  },
  retakeButton: {
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  retakeText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '600',
  },
  aiSuggestion: {
    backgroundColor: '#DBEAFE',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  aiSuggestionText: {
    color: '#1E40AF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  helpText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 8,
    fontStyle: 'italic',
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  cameraHeader: {
    paddingTop: 60,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeButton: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 24,
  },
  cameraHint: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    fontSize: 14,
  },
  cameraFooter: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 30,
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#E5E7EB',
  },
  captureButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
  },
  arCaptureButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  arCaptureIcon: {
    fontSize: 20,
  },
  arCaptureText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  arToggleButton: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  arToggleButtonActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.8)',
    borderColor: '#10B981',
  },
  arToggleButtonDisabled: {
    opacity: 0.5,
  },
  arToggleIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  arToggleText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: 'bold',
  },
  arToggleTextActive: {
    color: '#fff',
  },
  arInfoPanel: {
    position: 'absolute',
    bottom: 140,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  arInfoTitle: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  arInfoText: {
    color: '#fff',
    fontSize: 12,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  inputContainer: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  presetButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  presetText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  groutButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  groutButtonActive: {
    backgroundColor: '#F97316',
  },
  groutText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  groutTextActive: {
    color: '#fff',
  },
  calculateButton: {
    backgroundColor: '#2563EB',
    margin: 16,
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  calculateButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  resultCard: {
    backgroundColor: '#92400E',
    margin: 16,
    padding: 24,
    borderRadius: 16,
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  resultSection: {
    marginBottom: 20,
  },
  resultLabel: {
    fontSize: 16,
    color: '#FDE68A',
    marginBottom: 12,
    fontWeight: '600',
  },
  resultRow: {
    flexDirection: 'row',
    gap: 12,
  },
  resultBox: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  resultValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  cutValue: {
    color: '#FDE047',
  },
  resultSubtext: {
    fontSize: 12,
    color: '#FDE68A',
  },
  totalSection: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    padding: 20,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 16,
    color: '#FDE68A',
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
  },
  disclaimer: {
    fontSize: 11,
    color: '#FDE68A',
    textAlign: 'center',
    marginTop: 16,
  },
  
  zoomButton: {
  width: 50,
  height: 50,
  backgroundColor: 'rgba(0,0,0,0.6)',
  borderRadius: 25,
  justifyContent: 'center',
  alignItems: 'center',
  borderWidth: 2,
  borderColor: 'rgba(255,255,255,0.3)',
},
zoomButtonText: {
  color: '#fff',
  fontSize: 28,
  fontWeight: 'bold',
},
zoomIndicator: {
  backgroundColor: 'rgba(0,0,0,0.6)',
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.3)',
},
zoomIndicatorText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: 'bold',
  textAlign: 'center',
},
zoomSliderContainer: {
  gap: 20,
  alignItems: 'center',
},
zoomPreset: {
  width: 40,
  height: 40,
  backgroundColor: 'rgba(0,0,0,0.5)',
  borderRadius: 20,
  justifyContent: 'center',
  alignItems: 'center',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.3)',
},
zoomPresetActive: {
  backgroundColor: '#2563EB',
  borderColor: '#fff',
},
zoomPresetText: {
  color: 'rgba(255,255,255,0.7)',
  fontSize: 12,
  fontWeight: 'bold',
},
zoomPresetTextActive: {
  color: '#fff',
},

//obstacle_stuff//
obstacleItem: {
  backgroundColor: '#fff',
  padding: 12,
  borderRadius: 8,
  marginBottom: 8,
  borderLeftWidth: 4,
  borderLeftColor: '#F59E0B',
},
obstacleType: {
  fontSize: 16,
  fontWeight: 'bold',
  color: '#92400E',
  marginBottom: 4,
},
obstacleLocation: {
  fontSize: 14,
  color: '#78350F',
  marginBottom: 4,
},
obstacleCut: {
  fontSize: 13,
  color: '#B45309',
  fontStyle: 'italic',
},
obstacleTotal: {
  fontSize: 14,
  fontWeight: 'bold',
  color: '#92400E',
  marginTop: 8,
  textAlign: 'center',
},
});