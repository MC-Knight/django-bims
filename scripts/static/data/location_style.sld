<?xml version="1.0" encoding="UTF-8"?>
<sld:StyledLayerDescriptor 
    xmlns="http://www.opengis.net/sld"
    xmlns:sld="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    version="1.0.0">

  <sld:NamedLayer>
    <sld:Name>Pin Styler</sld:Name>
    <sld:UserStyle>
      <sld:Name>Pin Styler</sld:Name>
      <sld:Title>Pin Styler using PNG</sld:Title>

      <sld:FeatureTypeStyle>
        <sld:Rule>
          <sld:Title>Red Pin</sld:Title>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <!-- Reference to your PNG inside GeoServer data directory -->
                <sld:OnlineResource xlink:href="file:///home/geoserveruser/shapefiles/red_pin.png" xlink:type="simple"/>
                <sld:Format>image/png</sld:Format>
              </sld:ExternalGraphic>
              <!-- Adjust size if needed -->
              <sld:Size>24</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>

    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>
