import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import {
  ViroARScene,
  ViroARSceneNavigator,
  ViroARPlane,
  ViroNode,
  ViroBox,
  ViroMaterials,
  ViroText,
  ViroQuad,
  ViroAmbientLight,
} from '@reactvision/react-viro';

// Log when module loads
console.log('🔮 ViroARScene module loaded');

// Create materials for tiles
ViroMaterials.createMaterials({
  tileFull: {
    diffuseColor: 'rgba(16, 185, 129, 0.5)', // Green for full tiles
    lightingModel: 'Constant',
  },
  tileCut: {
    diffuseColor: 'rgba(245, 158, 11, 0.5)', // Yellow/orange for edge tiles
    lightingModel: 'Constant',
  },
  tileOutline: {
    diffuseColor: 'rgba(255, 255, 255, 0.8)', // White outline
    lightingModel: 'Constant',
  },
});

interface TileGridARSceneProps {
  tileWidth: number;  // in inches
  tileHeight: number; // in inches
  groutSpacing: number; // in inches
  wallWidth?: number;  // AI-detected wall width in inches
  wallHeight?: number; // AI-detected wall height in inches
  onPlaneDetected?: (planeId: string, dimensions: { width: number; height: number }, alignment: string) => void;
}

const TileGridARScene = (props: TileGridARSceneProps) => {
  const { tileWidth, tileHeight, groutSpacing, wallWidth, wallHeight, onPlaneDetected } = props;
  const [detectedPlanes, setDetectedPlanes] = useState<Map<string, { width: number; height: number; center: number[]; alignment: string }>>(new Map());
  const [debugText, setDebugText] = useState('Initializing AR...');
  const [frameCount, setFrameCount] = useState(0);
  const [primaryPlaneId, setPrimaryPlaneId] = useState<string | null>(null); // Track the main plane to show tiles on

  // Log on component mount
  useEffect(() => {
    console.log('🎬 TileGridARScene mounted');
    console.log('📏 Tile dimensions:', tileWidth, 'x', tileHeight, 'inches');
    return () => console.log('🛑 TileGridARScene unmounted');
  }, []);

  // Convert inches to meters (ViroReact uses meters)
  const inchesToMeters = (inches: number) => inches * 0.0254;

  const effectiveTileW = inchesToMeters(tileWidth + groutSpacing);
  const effectiveTileH = inchesToMeters(tileHeight + groutSpacing);
  const tileDepth = 0.003; // 3mm depth for better visibility

  // Handle plane anchor found - accept both Horizontal and Vertical
  const onAnchorFound = useCallback((anchor: any) => {
    console.log('🎯 Anchor found:', JSON.stringify(anchor));
    setDebugText(`Found: ${anchor.type || 'unknown'} - ${anchor.alignment || 'unknown'}`);

    if (anchor.type === 'plane' || anchor.alignment) {
      const planeWidth = anchor.width || 0.5;
      const planeHeight = anchor.height || 0.5;
      const center = anchor.center || [0, 0, 0];

      // Normalize alignment - HorizontalUpward/HorizontalDownward -> Horizontal
      let normalizedAlignment = anchor.alignment;
      if (anchor.alignment?.includes('Horizontal')) {
        normalizedAlignment = 'Horizontal';
      } else if (anchor.alignment?.includes('Vertical')) {
        normalizedAlignment = 'Vertical';
      }

      console.log('🎯 Adding plane:', anchor.anchorId, normalizedAlignment, planeWidth.toFixed(2), 'x', planeHeight.toFixed(2));

      setDetectedPlanes(prev => {
        const newPlanes = new Map(prev);
        newPlanes.set(anchor.anchorId, {
          width: planeWidth,
          height: planeHeight,
          center,
          alignment: normalizedAlignment
        });
        console.log('📊 Total planes now:', newPlanes.size);
        return newPlanes;
      });

      if (onPlaneDetected) {
        onPlaneDetected(anchor.anchorId, {
          width: planeWidth / 0.0254,
          height: planeHeight / 0.0254
        }, anchor.alignment);
      }
    }
  }, [onPlaneDetected]);

  // Handle plane anchor updated
  const onAnchorUpdated = useCallback((anchor: any) => {
    if (anchor.type === 'plane' || anchor.alignment) {
      // Normalize alignment
      let normalizedAlignment = anchor.alignment;
      if (anchor.alignment?.includes('Horizontal')) {
        normalizedAlignment = 'Horizontal';
      } else if (anchor.alignment?.includes('Vertical')) {
        normalizedAlignment = 'Vertical';
      }

      setDetectedPlanes(prev => {
        const newPlanes = new Map(prev);
        newPlanes.set(anchor.anchorId, {
          width: anchor.width || 0.5,
          height: anchor.height || 0.5,
          center: anchor.center || [0, 0, 0],
          alignment: normalizedAlignment
        });
        return newPlanes;
      });

      if (onPlaneDetected) {
        onPlaneDetected(anchor.anchorId, {
          width: (anchor.width || 0.5) / 0.0254,
          height: (anchor.height || 0.5) / 0.0254
        }, anchor.alignment);
      }
    }
  }, [onPlaneDetected]);

  // Generate tile grid for a detected plane
  const renderTileGrid = (planeId: string, planeData: { width: number; height: number; alignment: string }) => {
    const tiles: JSX.Element[] = [];
    const { width: planeW, height: planeH, alignment } = planeData;

    // If we have AI-detected wall dimensions, use those instead of AR-detected size
    // This makes the grid more consistent with what the user photographed
    let gridW: number;
    let gridH: number;

    if (wallWidth && wallHeight && alignment === 'Vertical') {
      // Use AI dimensions for walls (convert inches to meters)
      gridW = inchesToMeters(wallWidth);
      gridH = inchesToMeters(wallHeight);
      console.log('📐 Using AI wall dimensions:', wallWidth, 'x', wallHeight, 'inches');
    } else {
      // Fall back to AR-detected size with limits
      gridW = Math.min(Math.max(planeW, 0.3), 3); // 0.3m to 3m
      gridH = Math.min(Math.max(planeH, 0.3), 3);
    }

    // Calculate how many tiles fit
    const tilesWide = Math.max(1, Math.ceil(gridW / effectiveTileW));
    const tilesHigh = Math.max(1, Math.ceil(gridH / effectiveTileH));

    // Limit to prevent performance issues
    const maxTilesW = Math.min(tilesWide, 10);
    const maxTilesH = Math.min(tilesHigh, 10);

    // Calculate starting position (center the grid)
    const startX = -(maxTilesW * effectiveTileW) / 2;
    const startZ = -(maxTilesH * effectiveTileH) / 2;

    for (let row = 0; row < maxTilesH; row++) {
      for (let col = 0; col < maxTilesW; col++) {
        const x = startX + col * effectiveTileW + effectiveTileW / 2;
        const z = startZ + row * effectiveTileH + effectiveTileH / 2;

        // Edge tiles need cuts
        const isEdge = col === maxTilesW - 1 || row === maxTilesH - 1;
        const tileKey = `${planeId}-tile-${row}-${col}`;

        // For horizontal planes (floor), tiles lay flat on XZ plane
        // For vertical planes (walls), tiles are on XY plane
        let position: [number, number, number];
        let rotation: [number, number, number];

        if (alignment === 'Horizontal') {
          position = [x, 0.002, z]; // 2mm above surface
          rotation = [0, 0, 0];
        } else {
          position = [x, z, 0.002]; // 2mm in front of wall
          rotation = [0, 0, 0];
        }

        // Use ViroQuad for flat tiles (better performance than ViroBox)
        tiles.push(
          <ViroQuad
            key={tileKey}
            position={position}
            rotation={alignment === 'Horizontal' ? [-90, 0, 0] : [0, 0, 0]}
            width={inchesToMeters(tileWidth) * 0.92}
            height={inchesToMeters(tileHeight) * 0.92}
            materials={isEdge ? ['tileCut'] : ['tileFull']}
          />
        );
      }
    }

    return tiles;
  };

  const onTrackingUpdated = (state: any, reason: any) => {
    console.log('📍 AR Tracking state:', state, 'reason:', reason);
    const stateNames = ['Unknown', 'Limited', 'Not Available', 'Normal'];
    const reasonNames = ['None', 'Initializing', 'Excessive Motion', 'Insufficient Features'];
    const stateName = stateNames[state] || `Unknown(${state})`;
    const reasonName = reasonNames[reason] || `Unknown(${reason})`;
    setDebugText(`Tracking: ${stateName}\n${reasonName}`);
  };

  // Track camera movement to confirm AR is running
  const onCameraTransformUpdate = (cameraTransform: any) => {
    setFrameCount(prev => {
      const newCount = prev + 1;
      // Log every 60 frames (roughly every 1-2 seconds)
      if (newCount % 60 === 0) {
        console.log('📹 Camera frame:', newCount, 'Position:',
          cameraTransform.position?.map((p: number) => p.toFixed(2)).join(','));
      }
      return newCount;
    });
  };

  return (
    <ViroARScene
      onTrackingUpdated={onTrackingUpdated}
      onCameraTransformUpdate={onCameraTransformUpdate}
    >
      {/* Add ambient light so tiles are visible */}
      <ViroAmbientLight color="#ffffff" intensity={1000} />

      {/* Detect planes - just for detection, not rendering inside */}
      <ViroARPlane
        minHeight={0.1}
        minWidth={0.1}
        alignment="Horizontal"
        onAnchorFound={onAnchorFound}
        onAnchorUpdated={onAnchorUpdated}
      />

      <ViroARPlane
        minHeight={0.1}
        minWidth={0.1}
        alignment="Vertical"
        onAnchorFound={onAnchorFound}
        onAnchorUpdated={onAnchorUpdated}
      />

      {/* Render tiles OUTSIDE ViroARPlane so they persist */}
      {Array.from(detectedPlanes.entries()).map(([planeId, planeData]) => (
        <ViroNode
          key={planeId}
          position={planeData.center as [number, number, number]}
        >
          {renderTileGrid(planeId, planeData)}
        </ViroNode>
      ))}

      {/* TEST: Always visible cube to confirm AR rendering works */}
      <ViroBox
        position={[0, 0, -1]}
        width={0.1}
        height={0.1}
        length={0.1}
        materials={['tileFull']}
      />

      {/* Show debug/instruction text */}
      <ViroText
        text={`${debugText}\nPlanes: ${detectedPlanes.size} | Frames: ${frameCount}`}
        position={[0, 0.3, -1]}
        style={{
          fontFamily: 'Arial',
          fontSize: 14,
          color: '#FFFFFF',
          textAlignVertical: 'center',
          textAlign: 'center',
        }}
        width={2}
        height={0.5}
      />

      <ViroText
        text="If you see a green cube, AR is working!"
        position={[0, -0.2, -1]}
        style={{
          fontFamily: 'Arial',
          fontSize: 12,
          color: '#10B981',
          textAlignVertical: 'center',
          textAlign: 'center',
        }}
        width={2}
        height={0.3}
      />
    </ViroARScene>
  );
};

interface ViroTileARProps {
  tileWidth: string;
  tileHeight: string;
  groutSpacing: string;
  wallWidth?: string;  // AI-detected wall width
  wallHeight?: string; // AI-detected wall height
  onClose: () => void;
  onPlaneDetected?: (dimensions: { width: number; height: number }) => void;
}

export const ViroTileAR = ({ tileWidth, tileHeight, groutSpacing, wallWidth, wallHeight, onClose, onPlaneDetected }: ViroTileARProps) => {
  const [detectedSurfaces, setDetectedSurfaces] = useState<{ width: number; height: number; type: string }[]>([]);

  const handlePlaneDetected = useCallback((planeId: string, dimensions: { width: number; height: number }, alignment: string) => {
    setDetectedSurfaces(prev => {
      // Check if we already have this surface type
      const existing = prev.find(s => s.type === alignment);
      if (existing) {
        // Update dimensions if larger
        if (dimensions.width > existing.width || dimensions.height > existing.height) {
          return prev.map(s => s.type === alignment
            ? { ...dimensions, type: alignment }
            : s
          );
        }
        return prev;
      }
      return [...prev, { ...dimensions, type: alignment }];
    });

    if (onPlaneDetected) {
      onPlaneDetected(dimensions);
    }
  }, [onPlaneDetected]);

  const tileW = parseFloat(tileWidth) || 12;
  const tileH = parseFloat(tileHeight) || 12;
  const grout = parseFloat(groutSpacing) || 0.25;
  const wallW = wallWidth ? parseFloat(wallWidth) : undefined;
  const wallH = wallHeight ? parseFloat(wallHeight) : undefined;

  return (
    <View style={styles.container}>
      <ViroARSceneNavigator
        autofocus={true}
        initialScene={{
          scene: () => (
            <TileGridARScene
              tileWidth={tileW}
              tileHeight={tileH}
              groutSpacing={grout}
              wallWidth={wallW}
              wallHeight={wallH}
              onPlaneDetected={handlePlaneDetected}
            />
          ),
        }}
        style={styles.arView}
      />

      {/* Info Panel */}
      <View style={styles.infoPanel}>
        <Text style={styles.infoTitle}>AR Tile Preview</Text>
        <Text style={styles.infoText}>
          Tile: {tileW}" × {tileH}" | Grout: {grout}"
        </Text>
        {wallW && wallH && (
          <Text style={styles.infoText}>
            Wall: {wallW}" × {wallH}" (from AI)
          </Text>
        )}
        {detectedSurfaces.map((surface, i) => (
          <Text key={i} style={styles.infoText}>
            {surface.type}: {surface.width.toFixed(0)}" × {surface.height.toFixed(0)}"
          </Text>
        ))}
        {detectedSurfaces.length === 0 && (
          <Text style={styles.infoHint}>Point at floor or wall, move slowly</Text>
        )}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'rgba(16, 185, 129, 0.8)' }]} />
          <Text style={styles.legendText}>Full Tile</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'rgba(245, 158, 11, 0.8)' }]} />
          <Text style={styles.legendText}>Cut Tile</Text>
        </View>
      </View>

      {/* Close Button */}
      <TouchableOpacity style={styles.closeContainer} onPress={onClose}>
        <Text style={styles.closeButton}>✕ Close AR</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  arView: {
    flex: 1,
  },
  infoPanel: {
    position: 'absolute',
    top: 60,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    padding: 12,
    borderRadius: 12,
  },
  infoTitle: {
    color: '#10B981',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  infoText: {
    color: '#fff',
    fontSize: 14,
  },
  infoHint: {
    color: '#9CA3AF',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
  },
  legend: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendColor: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  legendText: {
    color: '#fff',
    fontSize: 12,
  },
  closeContainer: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  closeButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    overflow: 'hidden',
  },
});

export default ViroTileAR;
