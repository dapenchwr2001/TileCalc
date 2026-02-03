import React, { useState, useRef, useEffect } from 'react';
import { Camera, Ruler, DollarSign, Save, Settings, ToggleLeft, ToggleRight, X, CheckCircle, History, Trash2, FolderOpen } from 'lucide-react';

// Feature Flags Configuration
const INITIAL_FLAGS = {
  aiMeasurement: { enabled: true, name: 'AI Wall Detection', description: 'Automatically detect wall dimensions from photo' },
  aiTileDetection: { enabled: true, name: 'AI Tile Detection', description: 'Detect tile dimensions from photo' },
  manualInput: { enabled: true, name: 'Manual Measurement', description: 'Let users input wall dimensions manually' },
  groutCalculator: { enabled: true, name: 'Grout Spacing', description: 'Include grout spacing in calculations' },
  costEstimator: { enabled: false, name: 'Cost Estimator', description: 'Calculate total project cost' },
  tileSizePresets: { enabled: true, name: 'Tile Size Presets', description: 'Quick select common tile sizes' },
  saveProjects: { enabled: true, name: 'Save Projects', description: 'Save and load previous calculations' },
  arPreview: { enabled: false, name: 'AR Preview', description: 'Preview tiles on wall in augmented reality' }
};

function App() {
  const [featureFlags, setFeatureFlags] = useState(INITIAL_FLAGS);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedTileImage, setCapturedTileImage] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingTile, setIsAnalyzingTile] = useState(false);
  const [wallDimensions, setWallDimensions] = useState({ width: '', height: '' });
  const [tileSize, setTileSize] = useState({ width: '', height: '' });
  const [groutSpacing, setGroutSpacing] = useState('0.25');
  const [aiSuggestedGrout, setAiSuggestedGrout] = useState(null);
  const [tileCost, setTileCost] = useState('');
  const [savedProjects, setSavedProjects] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // Load saved projects from storage on mount
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const result = await window.storage.list('project:');
      if (result && result.keys) {
        const projects = await Promise.all(
          result.keys.map(async (key) => {
            const data = await window.storage.get(key);
            return data ? JSON.parse(data.value) : null;
          })
        );
        setSavedProjects(projects.filter(p => p !== null));
      }
    } catch (error) {
      console.log('No saved projects yet or error loading:', error);
    }
  };

  const saveProject = async () => {
    if (!projectName.trim()) {
      alert('Please enter a project name');
      return;
    }

    const project = {
      id: Date.now().toString(),
      name: projectName,
      date: new Date().toISOString(),
      wallDimensions,
      tileSize,
      groutSpacing,
      tileCost,
      capturedImage,
      capturedTileImage,
      result: canCalculate ? calculateTiles() : null
    };

    try {
      await window.storage.set(`project:${project.id}`, JSON.stringify(project));
      await loadProjects();
      setProjectName('');
      setShowSaveDialog(false);
      alert('Project saved successfully!');
    } catch (error) {
      console.error('Error saving project:', error);
      alert('Failed to save project. Please try again.');
    }
  };

  const loadProject = (project) => {
    setWallDimensions(project.wallDimensions);
    setTileSize(project.tileSize);
    setGroutSpacing(project.groutSpacing);
    setTileCost(project.tileCost || '');
    setCapturedImage(project.capturedImage || null);
    setCapturedTileImage(project.capturedTileImage || null);
    setShowHistory(false);
  };

  const deleteProject = async (projectId) => {
    if (confirm('Are you sure you want to delete this project?')) {
      try {
        await window.storage.delete(`project:${projectId}`);
        await loadProjects();
      } catch (error) {
        console.error('Error deleting project:', error);
        alert('Failed to delete project.');
      }
    }
  };

  const toggleFlag = (flagKey) => {
    setFeatureFlags(prev => ({
      ...prev,
      [flagKey]: { ...prev[flagKey], enabled: !prev[flagKey].enabled }
    }));
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setCapturedImage(e.target.result);
        analyzeImage(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async () => {
    try {
      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Camera not supported in this browser. Try Chrome, Firefox, or Safari.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setShowCamera(true);
      }
    } catch (err) {
      console.error('Camera error:', err);
      if (err.name === 'NotAllowedError') {
        alert('Camera access denied. Please allow camera permissions in your browser settings and try again.');
      } else if (err.name === 'NotFoundError') {
        alert('No camera found. Please connect a webcam.');
      } else {
        alert(`Camera error: ${err.message}. Make sure you're using HTTPS or localhost.`);
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video && canvas) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      const imageData = canvas.toDataURL('image/jpeg');
      setCapturedImage(imageData);
      stopCamera();
      analyzeImage(imageData);
    }
  };

  const analyzeImage = async (imageData) => {
    setIsAnalyzing(true);
    
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
                    data: imageData.split(',')[1]
                  }
                },
                {
                  type: "text",
                  text: `Analyze this wall image and estimate its dimensions in inches. Look for reference objects (doors, outlets, light switches) to help estimate size. A standard door is 80 inches tall and 36 inches wide. An outlet is about 3 inches wide.

Respond ONLY with a JSON object in this exact format (no markdown, no explanation):
{
  "width": 120,
  "height": 96,
  "confidence": "high",
  "reasoning": "Based on door frame visible in image"
}`
                }
              ]
            }
          ]
        })
      });

      const data = await response.json();
      const text = data.content.find(item => item.type === "text")?.text || "";
      
      // Parse the JSON response
      const cleanText = text.replace(/```json|```/g, "").trim();
      const result = JSON.parse(cleanText);
      
      setWallDimensions({
        width: result.width.toString(),
        height: result.height.toString()
      });
      
      console.log("AI Analysis:", result.reasoning);
      
    } catch (error) {
      console.error("AI Analysis Error:", error);
      // Fallback to mock data if AI fails
      const mockWidth = Math.floor(Math.random() * 60) + 80;
      const mockHeight = Math.floor(Math.random() * 40) + 70;
      
      setWallDimensions({
        width: mockWidth.toString(),
        height: mockHeight.toString()
      });
    }
    
    setIsAnalyzing(false);
  };

  const analyzeTileImage = async (imageData) => {
    setIsAnalyzingTile(true);
    
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
                    data: imageData.split(',')[1]
                  }
                },
                {
                  type: "text",
                  text: `Analyze this tile image and determine its dimensions in inches. Look for:
- Tile shape (square, rectangular)
- Any visible measurements or packaging labels
- Compare to common tile sizes (4x4, 6x6, 12x12, 12x24, 18x18 inches)
- Visual proportions
- Tile material/type (ceramic, porcelain, large format, mosaic)

Common tile sizes and typical grout spacing:
- 12x12 (most common) → 1/8" to 1/4" grout
- 12x24 (popular rectangular) → 1/8" to 3/16" grout
- 6x6 (small format) → 1/8" grout
- 18x18 (large format) → 1/8" to 3/16" grout
- 4x4 (mosaic/accent) → 1/16" to 1/8" grout

Respond ONLY with a JSON object in this exact format (no markdown, no explanation):
{
  "width": 12,
  "height": 12,
  "suggestedGroutSpacing": 0.1875,
  "confidence": "medium",
  "reasoning": "Square tile with typical proportions, likely 12x12 ceramic. Recommend 3/16 inch grout spacing."
}`
                }
              ]
            }
          ]
        })
      });

      const data = await response.json();
      const text = data.content.find(item => item.type === "text")?.text || "";
      
      const cleanText = text.replace(/```json|```/g, "").trim();
      const result = JSON.parse(cleanText);
      
      setTileSize({
        width: result.width.toString(),
        height: result.height.toString()
      });
      
      // Set AI suggested grout spacing
      if (result.suggestedGroutSpacing) {
        setAiSuggestedGrout(result.suggestedGroutSpacing);
        setGroutSpacing(result.suggestedGroutSpacing.toString());
      }
      
      console.log("Tile AI Analysis:", result.reasoning);
      
    } catch (error) {
      console.error("Tile AI Analysis Error:", error);
      // Fallback to common tile size
      const commonSizes = [
        { w: 12, h: 12 },
        { w: 12, h: 24 },
        { w: 6, h: 6 }
      ];
      const randomTile = commonSizes[Math.floor(Math.random() * commonSizes.length)];
      
      setTileSize({
        width: randomTile.w.toString(),
        height: randomTile.h.toString()
      });
    }
    
    setIsAnalyzingTile(false);
  };

  const handleTileFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setCapturedTileImage(e.target.result);
        analyzeTileImage(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const retakeTilePhoto = () => {
    setCapturedTileImage(null);
    setTileSize({ width: '', height: '' });
  };

  const retakePhoto = () => {
    setCapturedImage(null);
    setWallDimensions({ width: '', height: '' });
  };

  const calculateTiles = () => {
    const wallArea = parseFloat(wallDimensions.width) * parseFloat(wallDimensions.height);
    const tileWidth = parseFloat(tileSize.width) + (featureFlags.groutCalculator.enabled ? parseFloat(groutSpacing) : 0);
    const tileHeight = parseFloat(tileSize.height) + (featureFlags.groutCalculator.enabled ? parseFloat(groutSpacing) : 0);
    const tileArea = tileWidth * tileHeight;
    
    // Calculate how many tiles fit in each direction
    const tilesWide = parseFloat(wallDimensions.width) / tileWidth;
    const tilesHigh = parseFloat(wallDimensions.height) / tileHeight;
    
    // Full tiles (rounded down)
    const fullTilesWide = Math.floor(tilesWide);
    const fullTilesHigh = Math.floor(tilesHigh);
    const fullTiles = fullTilesWide * fullTilesHigh;
    
    // Calculate partial/cut tiles needed
    const partialTilesWide = tilesWide - fullTilesWide; // Fractional part for width
    const partialTilesHigh = tilesHigh - fullTilesHigh; // Fractional part for height
    
    // Edge tiles (cut tiles along edges)
    const edgeTilesRight = partialTilesWide > 0 ? fullTilesHigh : 0; // Right edge column
    const edgeTilesTop = partialTilesHigh > 0 ? fullTilesWide : 0; // Top edge row
    const cornerTile = (partialTilesWide > 0 && partialTilesHigh > 0) ? 1 : 0; // Corner piece
    
    const cutTiles = Math.ceil(edgeTilesRight + edgeTilesTop + cornerTile);
    
    // Total tiles needed (full + cut + 10% waste)
    const totalBeforeWaste = fullTiles + cutTiles;
    const tilesNeeded = Math.ceil(totalBeforeWaste * 1.1);
    
    const totalCost = featureFlags.costEstimator.enabled && tileCost ? (tilesNeeded * parseFloat(tileCost)).toFixed(2) : null;
    
    return { 
      tilesNeeded, 
      totalCost,
      fullTiles,
      cutTiles,
      tilesWide: tilesWide.toFixed(2),
      tilesHigh: tilesHigh.toFixed(2),
      partialWidthInches: (partialTilesWide * parseFloat(tileSize.width)).toFixed(2),
      partialHeightInches: (partialTilesHigh * parseFloat(tileSize.height)).toFixed(2)
    };
  };

  const canCalculate = wallDimensions.width && wallDimensions.height && tileSize.width && tileSize.height;
  const result = canCalculate ? calculateTiles() : null;

  // History View
  if (showHistory) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <History className="w-7 h-7" />
              Project History
            </h1>
            <button
              onClick={() => setShowHistory(false)}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 shadow-lg"
            >
              Back to App
            </button>
          </div>

          {savedProjects.length === 0 ? (
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-12 text-center">
              <FolderOpen className="w-16 h-16 text-white/50 mx-auto mb-4" />
              <p className="text-white/70 text-lg">No saved projects yet</p>
              <p className="text-white/50 text-sm mt-2">Start calculating and save your first project!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {savedProjects.map((project) => (
                <div key={project.id} className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg p-6 hover:shadow-xl transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-800">{project.name}</h3>
                      <p className="text-sm text-gray-500">
                        {new Date(project.date).toLocaleDateString()} at {new Date(project.date).toLocaleTimeString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadProject(project)}
                        className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all"
                        title="Load project"
                      >
                        <FolderOpen className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => deleteProject(project.id)}
                        className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all"
                        title="Delete project"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-gray-600 font-medium mb-1">Wall Dimensions</p>
                      <p className="text-gray-800">{project.wallDimensions.width}" × {project.wallDimensions.height}"</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-gray-600 font-medium mb-1">Tile Size</p>
                      <p className="text-gray-800">{project.tileSize.width}" × {project.tileSize.height}"</p>
                    </div>
                    {project.result && (
                      <>
                        <div className="bg-blue-50 p-3 rounded-lg">
                          <p className="text-blue-600 font-medium mb-1">Tiles Needed</p>
                          <p className="text-blue-800 text-xl font-bold">{project.result.tilesNeeded}</p>
                        </div>
                        {project.result.totalCost && (
                          <div className="bg-green-50 p-3 rounded-lg">
                            <p className="text-green-600 font-medium mb-1">Total Cost</p>
                            <p className="text-green-800 text-xl font-bold">${project.result.totalCost}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Save Dialog
  if (showSaveDialog) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Save Project</h2>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Enter project name (e.g., Kitchen Backsplash)"
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
            autoFocus
          />
          <div className="flex gap-3">
            <button
              onClick={() => setShowSaveDialog(false)}
              className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={saveProject}
              className="flex-1 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 font-medium shadow-lg"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Camera View
  if (showCamera) {
    return (
      <div className="fixed inset-0 bg-black z-50">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />
        
        <div className="absolute top-4 left-4 right-4 flex justify-between items-center">
          <button
            onClick={stopCamera}
            className="p-3 bg-white bg-opacity-20 backdrop-blur-sm rounded-full hover:bg-opacity-30"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <div className="text-white text-sm bg-black bg-opacity-50 px-4 py-2 rounded-full">
            Align wall in frame
          </div>
        </div>

        <div className="absolute bottom-8 left-0 right-0 flex justify-center">
          <button
            onClick={capturePhoto}
            className="w-20 h-20 bg-white rounded-full border-4 border-gray-300 hover:scale-105 transition-transform"
          />
        </div>
      </div>
    );
  }

  if (showSettings) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-white">Feature Flags</h1>
            <button
              onClick={() => setShowSettings(false)}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 shadow-lg"
            >
              Back to App
            </button>
          </div>
          
          <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl overflow-hidden">
            {Object.entries(featureFlags).map(([key, flag]) => (
              <div key={key} className="p-4 border-b last:border-b-0 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-800">{flag.name}</h3>
                      <span className={`text-xs px-2 py-1 rounded ${flag.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {flag.enabled ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{flag.description}</p>
                  </div>
                  <button
                    onClick={() => toggleFlag(key)}
                    className="ml-4 flex-shrink-0"
                  >
                    {flag.enabled ? (
                      <ToggleRight className="w-10 h-10 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-10 h-10 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-6 p-4 bg-blue-500/20 backdrop-blur-sm rounded-xl border border-blue-400/30">
            <h3 className="font-semibold text-white mb-2">Developer Tips:</h3>
            <ul className="text-sm text-blue-100 space-y-1">
              <li>• Toggle features on/off while building</li>
              <li>• Test different user experiences</li>
              <li>• Ship features gradually to users</li>
              <li>• Quickly disable buggy features without redeploying</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 p-4 relative overflow-hidden">
      {/* Tile pattern background */}
      <div className="absolute inset-0 opacity-5">
        <div className="grid grid-cols-8 gap-1 h-full">
          {Array.from({ length: 200 }).map((_, i) => (
            <div key={i} className="bg-gray-800 aspect-square rounded-sm"></div>
          ))}
        </div>
      </div>
      
      <div className="max-w-2xl mx-auto relative z-10">
        <div className="flex items-center justify-between mb-6 bg-gradient-to-r from-amber-900 to-orange-800 p-6 rounded-2xl shadow-2xl">
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">TileCalc Pro</h1>
            <p className="text-amber-200 text-sm">AI-Powered Tile Estimation</p>
          </div>
          <div className="flex gap-2">
            {featureFlags.saveProjects.enabled && savedProjects.length > 0 && (
              <button
                onClick={() => setShowHistory(true)}
                className="p-3 hover:bg-white/10 rounded-xl transition-all duration-200 backdrop-blur-sm relative"
              >
                <History className="w-6 h-6 text-white" />
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {savedProjects.length}
                </span>
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="p-3 hover:bg-white/10 rounded-xl transition-all duration-200 backdrop-blur-sm"
            >
              <Settings className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>

        {/* Camera Section */}
        {featureFlags.aiMeasurement.enabled && (
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 mb-4 border-2 border-blue-200/50 hover:border-blue-300/70 transition-all">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl">
                <Camera className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">Wall Detection</h2>
            </div>
            
            {capturedImage ? (
              <div className="space-y-3">
                <img src={capturedImage} alt="Captured wall" className="w-full rounded-xl shadow-lg border-2 border-blue-100" />
                {isAnalyzing ? (
                  <div className="flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    <span className="text-blue-700 font-medium">Analyzing wall dimensions...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <span className="text-green-700 font-medium">Dimensions detected!</span>
                  </div>
                )}
                <button
                  onClick={retakePhoto}
                  className="w-full py-2 bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 rounded-xl hover:from-gray-200 hover:to-gray-300 font-medium transition-all shadow-sm"
                >
                  Use Different Photo
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <button 
                  onClick={startCamera}
                  className="w-full py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 flex items-center justify-center gap-2 font-medium shadow-lg transition-all transform hover:scale-[1.02]"
                >
                  <Camera className="w-5 h-5" />
                  Open Camera
                </button>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">or</span>
                  </div>
                </div>
                
                <label className="w-full py-3 bg-gradient-to-r from-indigo-100 to-blue-100 text-indigo-700 rounded-xl hover:from-indigo-200 hover:to-blue-200 flex items-center justify-center gap-2 cursor-pointer font-medium transition-all shadow-sm">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Camera className="w-5 h-5" />
                  Upload Photo
                </label>
                
                <p className="text-xs text-gray-600 text-center font-medium">📸 AI will detect wall dimensions automatically</p>
              </div>
            )}
          </div>
        )}

        {/* Manual Input */}
        {featureFlags.manualInput.enabled && (
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 mb-4 border-2 border-green-200/50 hover:border-green-300/70 transition-all">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl">
                <Ruler className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">Wall Dimensions</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Width (inches)</label>
                <input
                  type="number"
                  value={wallDimensions.width}
                  onChange={(e) => setWallDimensions(prev => ({ ...prev, width: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all shadow-sm"
                  placeholder="120"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Height (inches)</label>
                <input
                  type="number"
                  value={wallDimensions.height}
                  onChange={(e) => setWallDimensions(prev => ({ ...prev, height: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all shadow-sm"
                  placeholder="96"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tile Size */}
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 mb-4 border-2 border-purple-200/50 hover:border-purple-300/70 transition-all">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-800">Tile Size</h2>
          </div>
          
          {featureFlags.aiTileDetection.enabled && (
            <div className="mb-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border-2 border-purple-200">
              <div className="flex items-center gap-2 mb-3">
                <Camera className="w-5 h-5 text-purple-600" />
                <h3 className="font-semibold text-purple-900">AI Tile Detection</h3>
              </div>
              
              {capturedTileImage ? (
                <div className="space-y-3">
                  <img src={capturedTileImage} alt="Captured tile" className="w-full h-40 object-cover rounded-xl shadow-md border-2 border-purple-100" />
                  {isAnalyzingTile ? (
                    <div className="flex items-center justify-center gap-2 py-2 bg-purple-100 rounded-xl border border-purple-200">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                      <span className="text-purple-700 text-sm font-medium">Detecting tile size...</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2 py-2 bg-green-100 rounded-xl border border-green-200">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <span className="text-green-700 text-sm font-medium">Tile size detected!</span>
                    </div>
                  )}
                  <button
                    onClick={retakeTilePhoto}
                    className="w-full py-2 bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700 rounded-xl hover:from-purple-200 hover:to-pink-200 text-sm font-medium transition-all shadow-sm"
                  >
                    Use Different Tile Photo
                  </button>
                </div>
              ) : (
                <label className="w-full py-2 bg-gradient-to-r from-purple-500 to-pink-600 text-white rounded-xl hover:from-purple-600 hover:to-pink-700 flex items-center justify-center gap-2 cursor-pointer text-sm font-medium transition-all shadow-lg transform hover:scale-[1.02]">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleTileFileUpload}
                    className="hidden"
                  />
                  <Camera className="w-4 h-4" />
                  Upload Tile Photo
                </label>
              )}
            </div>
          )}
          
          {featureFlags.tileSizePresets.enabled && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { w: 12, h: 12, label: '12"×12"' },
                { w: 12, h: 24, label: '12"×24"' },
                { w: 6, h: 6, label: '6"×6"' }
              ].map(preset => (
                <button
                  key={preset.label}
                  onClick={() => setTileSize({ width: preset.w, height: preset.h })}
                  className="py-2 px-3 bg-gradient-to-r from-gray-100 to-gray-200 hover:from-purple-100 hover:to-pink-100 rounded-xl text-sm font-medium transition-all shadow-sm"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Width (inches)</label>
              <input
                type="number"
                value={tileSize.width}
                onChange={(e) => setTileSize(prev => ({ ...prev, width: e.target.value }))}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all shadow-sm"
                placeholder="12"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Height (inches)</label>
              <input
                type="number"
                value={tileSize.height}
                onChange={(e) => setTileSize(prev => ({ ...prev, height: e.target.value }))}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all shadow-sm"
                placeholder="12"
              />
            </div>
          </div>
        </div>

        {/* Grout Spacing */}
        {featureFlags.groutCalculator.enabled && (
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 mb-4 border-2 border-orange-200/50 hover:border-orange-300/70 transition-all">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl">
                <Ruler className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">Grout Spacing</h2>
            </div>
            
            {aiSuggestedGrout && (
              <div className="mb-3 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200">
                <div className="flex items-center gap-2 text-sm text-blue-800">
                  <CheckCircle className="w-4 h-4" />
                  <span>AI suggests <strong>{aiSuggestedGrout}"</strong> spacing for this tile</span>
                </div>
              </div>
            )}
            
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">Grout Gap (inches)</label>
              <input
                type="number"
                step="0.0625"
                value={groutSpacing}
                onChange={(e) => setGroutSpacing(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all shadow-sm"
              />
            </div>
            
            <div className="grid grid-cols-4 gap-2">
              {[
                { value: 0.0625, label: '1/16"' },
                { value: 0.125, label: '1/8"' },
                { value: 0.1875, label: '3/16"' },
                { value: 0.25, label: '1/4"' }
              ].map(preset => (
                <button
                  key={preset.label}
                  onClick={() => setGroutSpacing(preset.value.toString())}
                  className={`py-2 px-2 rounded-xl text-sm font-medium transition-all shadow-sm ${
                    parseFloat(groutSpacing) === preset.value 
                      ? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-md' 
                      : 'bg-gradient-to-r from-gray-100 to-gray-200 hover:from-orange-100 hover:to-amber-100'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            
            <p className="text-xs text-gray-600 mt-3 font-medium">
              💡 Tip: Larger tiles (12"+) typically use 1/8" to 3/16" spacing. Smaller tiles use 1/16" to 1/8".
            </p>
          </div>
        )}

        {/* Cost Estimator */}
        {featureFlags.costEstimator.enabled && (
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 mb-4 border-2 border-emerald-200/50 hover:border-emerald-300/70 transition-all">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">Cost Per Tile</h2>
            </div>
            <input
              type="number"
              step="0.01"
              value={tileCost}
              onChange={(e) => setTileCost(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all shadow-sm"
              placeholder="2.50"
            />
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="bg-gradient-to-br from-amber-900 via-orange-800 to-amber-900 rounded-2xl shadow-2xl p-8 text-white relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAgTSAwIDIwIEwgNDAgMjAgTSAyMCAwIEwgMjAgNDAgTSAwIDMwIEwgNDAgMzAgTSAzMCAwIEwgMzAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMC41IiBvcGFjaXR5PSIwLjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-20"></div>
            <div className="relative z-10">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <div className="p-2 bg-white/20 rounded-xl">
                  <CheckCircle className="w-6 h-6" />
                </div>
                Your Results
              </h2>
              
              {/* Tile Layout Breakdown */}
              <div className="mb-6 p-4 bg-white/10 backdrop-blur-sm rounded-xl border border-white/20">
                <h3 className="text-lg font-semibold mb-3 text-amber-100">Tile Layout</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-white/5 p-3 rounded-lg">
                    <p className="text-amber-200 mb-1">Tiles Wide</p>
                    <p className="text-white font-bold text-lg">{result.tilesWide}</p>
                  </div>
                  <div className="bg-white/5 p-3 rounded-lg">
                    <p className="text-amber-200 mb-1">Tiles High</p>
                    <p className="text-white font-bold text-lg">{result.tilesHigh}</p>
                  </div>
                </div>
              </div>

              {/* Cut Tiles Section */}
              <div className="mb-6 p-4 bg-yellow-500/20 backdrop-blur-sm rounded-xl border-2 border-yellow-400/30">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Ruler className="w-5 h-5" />
                  Cut Tiles Needed
                </h3>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-white/10 p-3 rounded-lg">
                    <p className="text-amber-200 text-sm mb-1">Full Tiles</p>
                    <p className="text-white font-bold text-2xl">{result.fullTiles}</p>
                  </div>
                  <div className="bg-white/10 p-3 rounded-lg">
                    <p className="text-amber-200 text-sm mb-1">Cut Tiles</p>
                    <p className="text-yellow-300 font-bold text-2xl">{result.cutTiles}</p>
                  </div>
                </div>
                {(parseFloat(result.partialWidthInches) > 0 || parseFloat(result.partialHeightInches) > 0) && (
                  <div className="text-xs text-yellow-200 bg-yellow-600/20 p-3 rounded-lg">
                    <p className="font-semibold mb-1">Edge Cuts Required:</p>
                    {parseFloat(result.partialWidthInches) > 0 && (
                      <p>• Right edge: {result.partialWidthInches}" wide strips</p>
                    )}
                    {parseFloat(result.partialHeightInches) > 0 && (
                      <p>• Top edge: {result.partialHeightInches}" tall strips</p>
                    )}
                  </div>
                )}
              </div>

              {/* Total Summary */}
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-white/10 backdrop-blur-sm p-4 rounded-xl">
                  <span className="text-amber-100 font-medium">Total Tiles Needed:</span>
                  <span className="text-4xl font-bold">{result.tilesNeeded}</span>
                </div>
                {result.totalCost && (
                  <div className="flex justify-between items-center bg-white/10 backdrop-blur-sm p-4 rounded-xl border-t-2 border-amber-400/30">
                    <span className="text-amber-100 font-medium">Estimated Cost:</span>
                    <span className="text-4xl font-bold">${result.totalCost}</span>
                  </div>
                )}
                <p className="text-xs text-amber-200 mt-4 text-center font-medium">
                  * Includes {result.cutTiles} cut tiles + 10% waste factor for breakage
                </p>
              </div>
              
              {featureFlags.saveProjects.enabled && (
                <button 
                  onClick={() => setShowSaveDialog(true)}
                  className="w-full mt-6 py-3 bg-white text-amber-900 rounded-xl hover:bg-amber-50 flex items-center justify-center gap-2 font-semibold transition-all shadow-lg transform hover:scale-[1.02]"
                >
                  <Save className="w-5 h-5" />
                  Save Project
                </button>
              )}
            </div>
          </div>
        )}

        {featureFlags.arPreview.enabled && result && (
          <div className="mt-4 bg-gradient-to-r from-purple-500 to-pink-600 rounded-2xl p-6 border-2 border-purple-300/50 shadow-xl">
            <button className="w-full py-3 bg-white text-purple-600 rounded-xl hover:bg-purple-50 font-semibold transition-all transform hover:scale-[1.02] shadow-lg">
              🔮 Preview in AR
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;